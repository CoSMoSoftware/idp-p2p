const TransactionManager = require("transaction-manager");
const PORT = 8084;

//HTTP&WS stuff
const https = require ('https');
const url = require ('url');
const fs = require ('fs');
const path = require ('path');
const WebSocketServer = require ('websocket').server;

const base = 'www';

const options = {
	key: fs.readFileSync ('server.key'),
	cert: fs.readFileSync ('server.cert')
};

// maps file extention to MIME typere
const map = {
	'.ico': 'image/x-icon',
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.doc': 'application/msword'
};


//Create HTTP server
const server = https.createServer (options, (req, res) => {
		// parse URL
	const parsedUrl = url.parse (req.url);
	// extract URL path
	let pathname = base + parsedUrl.pathname;
	// based on the URL path, extract the file extention. e.g. .js, .doc, ...
	const ext = path.parse (pathname).ext;

	//DO static file handling
	fs.exists (pathname, (exist) => {
		if (!exist)
		{
			// if the file is not found, return 404
			res.statusCode = 404;
			res.end (`File ${pathname} not found!`);
			return;
		}

		// if is a directory search for index file matching the extention
		if (fs.statSync (pathname).isDirectory ())
		{
			res.writeHead(302, {
			  'Location': parsedUrl.pathname + 'index.html'
			});
			res.end();
		}

		// read file from file system
		fs.readFile (pathname, (err, data) => {
			if (err)
			{
				//Error
				res.statusCode = 500;
				res.end (`Error getting the file: ${err}.`);
			} else {
				// if the file is found, set Content-type and send data
				res.setHeader ('Content-type', map[ext] || 'text/html');
				res.end (data);
			}
		});
	});
}).listen (PORT);

//Create ws server
const ws = new WebSocketServer ({
	httpServer: server,
	autoAcceptConnections: false
});

const rooms = new Map();


let max = 0;
//Listen for requests
ws.on ('request', async function(request) 
{
	//Get id
	const id = max++;
	
	function log(msg) {
		console.log("["+id+"] "+msg);
	}
	
	//Get protocol
	var protocol = request.requestedProtocols[0];
	
	//Accept the connection
	const connection = request.accept(protocol);
	
	//Create new transaction manager
	const tm = new TransactionManager(connection);
	
	//Create participant
	const us = {
		tm		: tm,
		connection	: connection
	};
	
	// parse URL
	const url = request.resourceURL;
	
	//Get room id
	const roomId = url.query.id;
	
	//Find the room id
	let room = rooms.get(roomId);
	
	log("Joining room " + roomId);
	
	//if not found
	if (!room) 
	{
		//Add this as participant
		room = {
			id		: roomId,
			participants	: [us]
		};
		//Add it
		rooms.set(roomId,room);
		
		log("Creating room " + roomId);
	} else {
		//Check number of participants
		if (room.participants.length>1)
			//error
			return connection.close();
		//Add us to participants
		room.participants.push(us);
		//send event to the other side
		room.participants[0].tm.event("joined");
	}
	
	//Listen for events
	tm.on("cmd",async function(cmd) {
		log("cmd "+cmd.name);
		try
		{
			//THe other participant
			let other;
			//Get the other participant
			for (var i=0; i<room.participants.length; ++i)
				if (room.participants[i]!==this)
					//Got other
					other = room.participants[i];
			//Check command
			switch (cmd.name)
			{
				case "call":
					log("call");
					//Check there is other
					if (!other)
						return cmd.reject("No otherone to call");
					//send call event
					const called = await other.tm.cmd("call",cmd.data)
					log("called");
					//Send it to the other participant
					cmd.accept(called);
					log("accepted");
					break;
				case "end":
					log("end");
					//Check there is other
					if (other)
						//Send it to the other participant
						other.tm.event("ended",{});
					//Close all connections
					connection.close();
					other.connection.close();
					//remove room
					rooms.delete(roomId);
					//Done
					cmd.accept();
					break;
			}
		} catch (e) {
			log("rejecting command");
			console.error(e);
			cmd.reject(e);
		}
	});
	
	//Listen for events
	tm.on("event",(event)=>{
		log("event "+event.name);
		//Sned to the other side
		for (var i=0; i<room.participants.length; ++i)
			//If it is other
			if (room.participants[i]!==this)
				//Send it to the other participant
				room.participants[i].tm.event(event.name,event.data);
	});

	connection.on("close", function(){
		log("ws closed");
		//For all participants
		for (var i=0; i<room.participants.length; ++i)
		{
			//Send participant
			if (room.participants[i]!==this)
			{
				//Send it to the other participant
				room.participants[i].tm.event("ended",{});
				//Close connection
				room.participants[i].connection.close();
			}
				
		}
		//remove room
		rooms.delete(roomId);
	});
});