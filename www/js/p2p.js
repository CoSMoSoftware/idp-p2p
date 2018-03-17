let participants;
let audioDeviceId;

//Get our url
const href = new URL(window.location.href);
//Get id
const roomId = href.searchParams.get("roomId");

//Get ws url from navigaro url
const url = "wss://"+href.host;

	
function addVideoForStream(stream,muted)
{
	//CHeck it is not already present
	if (document.getElementById(stream.id)!=null)
		//Do nothing
		return;
	//Create new video element
	const video = document.createElement("video");
	//Set same id
	video.id = stream.id;
	//Set src stream
	video.srcObject = stream;
	//Set other properties
	video.autoplay = true;
	video.muted = muted;
	//Append it
	container.appendChild(video);
}

function removeVideoForStream(stream)
{
	//Get video
	var video = document.getElementById(stream.id);
	//Remove it when done
	video.addEventListener('webkitTransitionEnd',function(){
            //Delete it
	    video.parentElement.removeChild(video);
        });
	//Disable it first
	video.className = "disabled";
}

var pc = new RTCPeerConnection({
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" }
	]
});

function login(url)
{
	//Promise will resolve when we get the login message or rejected when login popup is closed
	return new Promise(function(resolve,reject){
		var popup;
		//Listen for messages
		window.addEventListener ("message", function (e) {
			//Check correct string
			if (e.data === "WEBRTC-LOGINDONE")
			{
				//Close popup
				popup.window.close();
				//We are logged
				resolve();
			}
		}, {once: true});

		//it failed, so we will have to log in
		var popup = window.open(url,'idp-login','directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=400,height=350');
	});
}

async function assertIdentity(domain,protocol, hint)
{
	//The assertion
	let assertion;

	//Set identity provier
	pc.setIdentityProvider(domain, protocol, hint);

	//Until we have an assertion
	while(!assertion)
	{
		try {
			//Create identity assertion
			assertion = await pc.getIdentityAssertion();
		} catch(e) {
			//Open login url
			await login(pc.idpLoginUrl);
		}
	}
}

function showRemoteIdentity(peerIdentity)
{
	console.log("asserted remote identity",peerIdentity);
	
	//Create div to display info
	const table = document.createElement("table");
	//Set id
	table.id = "peerIdentity";
	//For each property on the identity
	for (const [key,value] of Object.entries(peerIdentity))
	{
		//Create div to display info
		const tr = document.createElement("tr");
		//Set html
		tr.innerHTML ="<td>"+key+"<td><td>"+value+"</td>";
		//Add to div
		table.appendChild(tr);
	}
	//Append to document
	document.body.appendChild(table);
}

function connect(url,roomId) 
{
	const remotes = [];
	
	//Create room url
	const roomUrl = url +"?id="+roomId;
		
	var ws = new WebSocket(roomUrl);
	var tm = new TransactionManager(ws);
	
	pc.onaddstream = function(event) {
		console.debug("pc::onaddstream",event);
		//Play it
		addVideoForStream(event.stream);
	};
	
	pc.onremovestream = function(event) {
		console.debug("pc::onremovestream",event);
		//Play it
		removeVideoForStream(event.stream);
	};
	
	pc.ontrack = function(event) {
		console.debug("pc::ontrack",event);
		//Play it
		addVideoForStream(event.streams[0]);
	};
	
	pc.onicecandidate = function (evt) {
		tm.event("candidate",evt.candidate);
	};
	
	ws.onopen = async function()
	{
	        console.log("ws:opened");
		
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				deviceId: audioDeviceId
			},
			video: true
		});

		console.debug("md::getUserMedia sucess",stream);

		//Play it
		addVideoForStream(stream,true);
		//Add stream to peer connection
		pc.addStream(stream);
	}
	
	//Listen for command events
	tm.on("cmd",async function(cmd) 
	{
		console.log("tm::cmd",cmd);

		try
		{
			//check command
			switch(cmd.name)
			{
				case "call":
				{
					//Create new offer
					const offer = new RTCSessionDescription({
						type : 'offer',
						sdp  : cmd.data.sdp
					});

					//Set offer
					await pc.setRemoteDescription(offer);

					console.log("pc::setRemoteDescription succes",offer.sdp);
					
					//For all pending remote candidates
					while(remotes.length)
						//Add and remove
						pc.addIceCandidate(remotes.pop());

					//Create answer
					const answer = await pc.createAnswer();

					console.log("pc::createAnswer succes",answer.sdp);

					//Only set it locally
					await pc.setLocalDescription(answer);

					console.log("pc::setLocalDescription succes",answer.sdp);

					//Accept it
					cmd.accept({
						sdp : answer.sdp
					});
					
					try {
						//Show remote identity
						showRemoteIdentity(await pc.peerIdentity);
					} catch(e) {
						console.error("peer identity not asserted",e);
					}
					break;
				}
			}
		} catch (e) {
			//Reject with error
			console.error(e);
			cmd.reject(e);
		}
	});
	
	//Listen for events
	tm.on("event",async function(event) 
	{
		console.log("ts::event",event);
		try 
		{
			switch (event.name)
			{
				case "joined" :
				{
					//Other participant joined
					console.log("Other participant joined")

					//Create new offer
					const offer = await pc.createOffer({
						offerToReceiveAudio: true,
						offerToReceiveVideo: true
					});

					console.debug("pc::createOffer sucess",offer);

					//Set it
					pc.setLocalDescription(offer);

					console.log("pc::setLocalDescription succes",offer.sdp);

					//Start call
					const called = await tm.cmd("call",{
						sdp : offer.sdp
					});

					console.log("tm::cmd call succes",called);

					//Create answer
					const answer = new RTCSessionDescription({
						type	:'answer',
						sdp	: called.sdp
					});

					//Set it
					await pc.setRemoteDescription(answer);

					console.log("pc::setRemoteDescription succes",offer.sdp);
					
					//For all pending remote candidates
					while(remotes.length)
						//Add and remove
						pc.addIceCandidate(remotes.pop());
					
					console.log("pc::peerIdentity");
					try {
						//Show remote identity
						showRemoteIdentity(await pc.peerIdentity);
					} catch(e) {
						console.error("peer identity not asserted",e);
					}
					break;
				}
				case "candidate":
					//If we have remote offer alrad
					if (pc.currentRemoteDescription)
						//Add candidate
						pc.addIceCandidate(event.data);
					else
						//Keep it for later
						remotes.push(event.data);
					break;
				case "ended" :
					//Terminate
					ws.close();
					pc.close();
					break;	
			}
		} catch (e) {
			console.log(e);
		} 
	});
}

navigator.mediaDevices.getUserMedia({
	audio: true,
	video: true
})
.then(function(stream){	

	//Set the input value
	audio_devices.value = stream.getAudioTracks()[0].label;
	
	//Get the select
	var menu = document.getElementById("audio_devices_menu");
	
	//Populate the device lists
	navigator.mediaDevices.enumerateDevices()
		.then(function(devices) {
			//For each one
			devices.forEach(function(device) 
			{
				//It is a mic?
				if (device.kind==="audioinput")
				{
					//Create menu item
					var li = document.createElement("li");
					//Populate
					li.dataset["val"] = device.deviceId;	
					li.innerText = device.label;
					li.className = "mdl-menu__item";
					
					//Add listener
					li.addEventListener('click', function() {
						console.log(device.deviceId);
						//Close previous
						stream.getAudioTracks()[0].stop();
						//Store device id
						audioDeviceId = device.deviceId
						//Get stream for the device
						navigator.mediaDevices.getUserMedia({
							audio: {
								deviceId: device.deviceId
							},
							video: false
						})
						.then(function(stream){	
							//Store it
							soundMeter.connectToSource(stream).then(draw);
						});
	
					});
					//Append
					menu.appendChild (li);
				}
			});
			//Upgrade
			getmdlSelect.init('.getmdl-select');
		        componentHandler.upgradeDom();
		})
		.catch(function(error){
			console.log(error);
		});
	
	var fps = 20;
	var now;
	var then = Date.now();
	var interval = 1000/fps;
	var delta;
	var drawTimer;
	var soundMeter = new SoundMeter(window);
	//Stop
	cancelAnimationFrame(drawTimer);

	function draw() {
		drawTimer = requestAnimationFrame(draw);

		now = Date.now();
		delta = now - then;

		if (delta > interval) {
			then = now ;
			var tot = Math.min(100,(soundMeter.instant*200));
			//Get all 
			const voometers = document.querySelectorAll (".voometer");
			//Set new size
			for (let i=0;i<voometers.length;++i)
				voometers[i].style.width = (Math.floor(tot/5)*5) + "%";
		}
	
	}
	soundMeter.connectToSource(stream).then(draw);
	
	var dialog = document.querySelector('dialog');
	dialogPolyfill.registerDialog(dialog);
	dialog.showModal();
	
	if (roomId)
		dialog.querySelector('#roomId').parentElement.MaterialTextfield.change(roomId);
	
	dialog.querySelector('#random').addEventListener('click', function() {
		dialog.querySelector('#roomId').parentElement.MaterialTextfield.change(Math.random().toString(36).substring(7));
	});
	dialog.querySelector('form').addEventListener('submit', async function(event) {
		//Stop form for submitting
		event.preventDefault();
		//Close dialog
		dialog.close();
		//Assert identity
		await assertIdentity(this.domain.value, this.protocol.value, this.hint.value);
		//Set room info
		var a = document.querySelector(".room-info a");
		a.target = "_blank";
		a.href = "?roomId="+this.roomId.value;
		a.innerText = this.roomId.value;
		a.parentElement.style.opacity = 1;
		//Start connecting
		connect(url, this.roomId.value);
	});
})
.catch(console.error);

