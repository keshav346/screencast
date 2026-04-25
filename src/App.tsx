import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { MonitorUp, Tv, Info, Settings, Loader2, Mic, MicOff, RotateCw, Maximize, Minimize, ScanText, Check, Video, Square, Pause, Play, Users } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

export default function App() {
  const [role, setRole] = useState<'broadcaster' | 'viewer' | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenPaused, setIsScreenPaused] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractSuccess, setExtractSuccess] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [availableBroadcasters, setAvailableBroadcasters] = useState<{id: string, name: string}[]>([]);
  
  // Broadcaster state
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  
  // Viewer state
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const viewerPeerConnection = useRef<RTCPeerConnection | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (role === 'broadcaster' && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [role]);

  useEffect(() => {
    const socketio = io(window.location.origin, {
      transports: ['websocket']
    });
    
    socketio.on('connect', () => {
      console.log('Connected to signaling server');
      setIsReady(true);
      setErrorMessage(null);
    });

    socketio.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setErrorMessage('Failed to connect to signaling server. Please check your network.');
      setIsReady(false);
    });

    socketio.on('availableBroadcasters', (list) => {
      setAvailableBroadcasters(list);
    });
    
    setSocket(socketio);

    return () => {
      socketio.close();
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (!isNativeFs) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleStartBroadcast = async () => {
    if (!socket) return;
    setErrorMessage(null);

    // Check if the browser supports getDisplayMedia (Secure Context/New Tab)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        setErrorMessage("Screen sharing is generally not supported by mobile browsers. You can view broadcasts from this device, but you need a desktop browser to share your screen.");
      } else {
        setErrorMessage("Screen sharing is not supported in this view. Please click the 'Open in new tab' button at the top right to enable it.");
      }
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: true
      });
      
      localStreamRef.current = stream;
      setRole('broadcaster');
      
      socket.emit('broadcaster');

      socket.on('viewerCount', (count: number) => {
        setViewerCount(count);
      });

      socket.on('viewer', (id: string) => {
        const peerConnection = new RTCPeerConnection(ICE_SERVERS);
        peerConnections.current[id] = peerConnection;

        stream.getTracks().forEach(track => {
          peerConnection.addTrack(track, stream);
        });

        peerConnection.onicecandidate = event => {
          if (event.candidate) {
            socket.emit('candidate', id, event.candidate);
          }
        };

        peerConnection.createOffer()
          .then(sdp => peerConnection.setLocalDescription(sdp))
          .then(() => {
            socket.emit('offer', id, peerConnection.localDescription);
          })
          .catch(err => {
            console.error('Peer connection error:', err);
            setErrorMessage('Error establishing peer connection.');
          });
      });

      socket.on('answer', (id: string, description: RTCSessionDescriptionInit) => {
        const pc = peerConnections.current[id];
        if (pc) {
          pc.setRemoteDescription(description).catch(err => {
            console.error('Error setting remote description:', err);
            setErrorMessage('Sync error with viewer.');
          });
        }
      });

      socket.on('candidate', (id: string, candidate: RTCIceCandidateInit) => {
        const pc = peerConnections.current[id];
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
            console.error('Error adding ICE candidate:', err);
          });
        }
      });

      socket.on('disconnectPeer', (id: string) => {
        const pc = peerConnections.current[id];
        if (pc) {
          pc.close();
          delete peerConnections.current[id];
        }
      });

      stream.getVideoTracks()[0].onended = () => {
        handleStopBroadcast();
      };
      
    } catch (err) {
      console.error('Error sharing screen: ', err);
      setErrorMessage(err instanceof Error ? `Screenshare failed: ${err.message}` : 'Failed to share screen. Ensure you have given permissions.');
    }
  };

  const handleStopBroadcast = () => {
    setRole(null);
    setViewerCount(0);
    setIsMuted(false);
    setIsScreenPaused(false);
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    if (socket) {
      socket.disconnect();
      socket.connect();
    }
  };

  const handleWatch = (broadcasterId: string) => {
    if (!socket) return;
    setRole('viewer');
    setErrorMessage(null);
    
    socket.emit('watch', broadcasterId);

    socket.off('offer');
    socket.on('offer', (id: string, description: RTCSessionDescriptionInit) => {
      const peerConnection = new RTCPeerConnection(ICE_SERVERS);
      viewerPeerConnection.current = peerConnection;
      
      peerConnection.setRemoteDescription(description)
        .then(() => peerConnection.createAnswer())
        .then(sdp => peerConnection.setLocalDescription(sdp))
        .then(() => {
          socket.emit('answer', id, peerConnection.localDescription);
        })
        .catch(err => {
          console.error('Viewer connection error:', err);
          setErrorMessage('Error connecting to broadcast.');
        });

      peerConnection.ontrack = event => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      peerConnection.onicecandidate = event => {
        if (event.candidate) {
          socket.emit('candidate', id, event.candidate);
        }
      };
    });

    socket.off('candidate');
    socket.on('candidate', (id: string, candidate: RTCIceCandidateInit) => {
      if (viewerPeerConnection.current) {
        viewerPeerConnection.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
      }
    });

    socket.off('broadcasterDisconnected');
    socket.on('broadcasterDisconnected', () => {
      if (viewerPeerConnection.current) {
        viewerPeerConnection.current.close();
        viewerPeerConnection.current = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setErrorMessage('The broadcaster has ended the stream.');
      setRole(null);
    });
  };

  const handleStopWatching = () => {
    setRole(null);
    setRotation(0);
    
    if (isRecording && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);

    if (viewerPeerConnection.current) {
      viewerPeerConnection.current.close();
      viewerPeerConnection.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (socket) {
      socket.disconnect();
      socket.connect();
    }
  }

  const toggleRotation = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const toggleMute = () => {
    const stream = localStreamRef.current || localVideoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const newMutedState = !isMuted;
        audioTracks.forEach(track => {
          track.enabled = !newMutedState;
        });
        setIsMuted(newMutedState);
      } else {
        setErrorMessage("No audio track found in this share session.");
      }
    }
  };

  const togglePauseScreen = () => {
    const stream = localStreamRef.current || localVideoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        const newPauseState = !isScreenPaused;
        videoTracks[0].enabled = !newPauseState; // enabled=false means paused
        setIsScreenPaused(newPauseState);
      }
    }
  };

  const takeScreenshot = () => {
    const video = remoteVideoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `screenshot-${new Date().toISOString()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
      setErrorMessage('Failed to capture screenshot. This might be due to security restrictions.');
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        let nativeSuccess = false;
        try {
          if (viewerContainerRef.current?.requestFullscreen) {
            await viewerContainerRef.current.requestFullscreen();
            nativeSuccess = true;
          } else if ((viewerContainerRef.current as any)?.webkitRequestFullscreen) {
            await (viewerContainerRef.current as any).webkitRequestFullscreen();
            nativeSuccess = true;
          }
        } catch (e) {
          console.warn('Native fullscreen failed', e);
        }

        setIsFullscreen(true);
        
        try {
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          }
        } catch (e) { /* ignore */ }
      } else {
        setIsFullscreen(false);
        
        if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        }
        
        try {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
      setIsFullscreen(!isFullscreen);
    }
  };

  const extractText = async () => {
    const video = remoteVideoRef.current;
    if (!video || !video.videoWidth) return;

    setIsExtracting(true);
    setExtractSuccess(false);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: "Extract all the text from this image exactly as it appears. Maintain the formatting. If there is no text, reply 'NO_TEXT_FOUND'." },
              { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
            ]
          }
        ]
      });

      const text = response.text?.trim() || '';
      if (text && text !== 'NO_TEXT_FOUND') {
        try {
          await navigator.clipboard.writeText(text);
          setExtractSuccess(true);
          setTimeout(() => setExtractSuccess(false), 3000);
        } catch (clipboardErr) {
          console.error("Clipboard API failed", clipboardErr);
          // Fallback to alert if in an iframe
          alert('Extracted Text (clipboard blocked in iframe):\n\n' + text);
        }
      } else {
        setErrorMessage('No text found on the screen.');
      }
    } catch (err) {
      console.error('Error extracting text:', err);
      setErrorMessage('Failed to extract text. Note: this feature may require valid API keys.');
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    } else {
      const stream = remoteVideoRef.current?.srcObject as MediaStream;
      if (!stream) {
        setErrorMessage("No active video stream to record.");
        return;
      }
      recordedChunksRef.current = [];
      try {
        const options = { mimeType: 'video/webm;codecs=vp9,opus' };
        const mediaRecorder = new MediaRecorder(stream, options);
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          document.body.appendChild(a);
          a.style.display = 'none';
          a.href = url;
          a.download = `recording-${new Date().toISOString()}.webm`;
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
      } catch (e) {
        console.error("Error starting recording:", e);
        // Try fallback without specifying mime parameters if vp9 is not supported
        try {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          mediaRecorder.onstop = () => {
             const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             document.body.appendChild(a);
             a.style.display = 'none';
             a.href = url;
             a.download = `recording-${new Date().toISOString()}.webm`;
             a.click();
             window.URL.revokeObjectURL(url);
             document.body.removeChild(a);
          };
          mediaRecorder.start();
          mediaRecorderRef.current = mediaRecorder;
          setIsRecording(true);
        } catch (fallbackError) {
          console.error("Fallback recording failed:", fallbackError);
          setErrorMessage("Screen recording is not supported on this browser.");
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <MonitorUp className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">ScreenCast Local</h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium">
            {role === 'broadcaster' && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full">
                <Tv className="w-4 h-4" />
                <span>{viewerCount} Viewer{viewerCount !== 1 ? 's' : ''}</span>
              </div>
            )}
            <div className="text-slate-500">
              {isReady ? (
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500"></div> Connected</span>
              ) : (
                <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin"/> Connecting...</span>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {errorMessage && (
          <div className="mb-8 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
            <p className="flex items-center gap-2">
              <Info className="w-5 h-5 flex-shrink-0" />
              {errorMessage}
            </p>
            <button onClick={() => setErrorMessage(null)} className="text-red-900 hover:text-red-700 font-bold p-1">
              ✕
            </button>
          </div>
        )}

        {!role && (
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Broadcaster Option */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col items-center text-center transition-all hover:shadow-md">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
                <MonitorUp className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Share Your Screen</h2>
              <p className="text-slate-500 mb-8 max-w-sm">
                Broadcast your active screen to anyone connected to this local network. Only one person can broadcast at a time.
              </p>
              <button 
                onClick={handleStartBroadcast}
                disabled={!isReady}
                className="mt-auto bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-8 rounded-full transition-colors focus:ring-4 focus:ring-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
              >
                Start Broadcasting
              </button>
            </div>

            {/* Viewers Options */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col transition-all hover:shadow-md h-full">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Tv className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-1">Watch a Screen</h2>
                  <p className="text-slate-500 text-sm">Join an active broadcast</p>
                </div>
              </div>
              
              <div className="flex-1">
                {availableBroadcasters.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-[120px] bg-slate-50 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm">
                    <p>No active broadcasters found.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableBroadcasters.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => handleWatch(b.id)}
                        disabled={!isReady}
                        className="w-full bg-slate-50 hover:bg-teal-50 border border-slate-200 hover:border-teal-200 text-left p-4 rounded-xl transition-all flex justify-between items-center group focus:ring-4 focus:ring-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                         <span className="font-medium text-slate-700 group-hover:text-teal-700">{b.name}</span>
                         <span className="text-teal-600 font-semibold text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ml-4">Watch →</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {role === 'broadcaster' && (
          <div className="w-full flex flex-col items-center">
            <div className={`w-full max-w-5xl rounded-2xl overflow-hidden shadow-xl border relative aspect-video flex-col flex transition-all ${isScreenPaused ? 'bg-slate-900 border-slate-700' : 'bg-black border-slate-800'}`}>
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-full object-contain ${isScreenPaused ? 'opacity-30 blur-sm' : 'opacity-100'} transition-all`}
              />
              
              {isScreenPaused && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-20">
                  <Pause className="w-16 h-16 mb-4 opacity-80" />
                  <h3 className="text-2xl font-semibold">Broadcasting Paused</h3>
                  <p className="text-slate-300 mt-2">Viewers are currently seeing a frozen screen.</p>
                </div>
              )}

              <div className="absolute top-4 left-4 bg-red-600/90 text-white px-3 py-1.5 rounded-md text-xs font-bold tracking-wide uppercase flex items-center gap-1.5 backdrop-blur-sm shadow-lg z-30">
                <span className={`w-2 h-2 rounded-full bg-white ${isScreenPaused ? 'opacity-50' : 'animate-pulse'}`}></span>
                {isScreenPaused ? 'Paused' : 'Broadcasting'}
              </div>
              <div className="absolute top-4 right-4 bg-slate-900/80 text-white px-3 py-1.5 rounded-md text-xs font-medium backdrop-blur-sm flex items-center gap-2 z-30">
                <Users className="w-4 h-4 text-indigo-300" />
                {viewerCount} Viewer{viewerCount !== 1 ? 's' : ''}
              </div>
            </div>
            
            <div className="bg-white px-8 py-4 rounded-full shadow-lg border border-slate-200 mt-8 flex items-center gap-4 sm:gap-6">
              <button 
                onClick={togglePauseScreen}
                className={`p-4 rounded-full shadow-sm transition-all active:scale-95 flex items-center justify-center ${isScreenPaused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 ring-2 ring-amber-400 ring-offset-2' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title={isScreenPaused ? "Resume Screen" : "Pause Screen"}
              >
                {isScreenPaused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
              </button>
              
              <button 
                onClick={toggleMute}
                className={`p-4 rounded-full shadow-sm transition-all active:scale-95 flex items-center justify-center ${isMuted ? 'bg-red-100 text-red-600 hover:bg-red-200 ring-2 ring-red-400 ring-offset-2' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              
              <div className="w-px h-10 bg-slate-200 mx-2 hidden sm:block"></div>
              
              <button 
                onClick={handleStopBroadcast}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-8 sm:px-10 rounded-full transition-colors shadow-sm active:scale-95"
              >
                Stop Stream
              </button>
            </div>
          </div>
        )}

        {role === 'viewer' && (
          <div className={`w-full flex-col flex items-center ${isFullscreen ? 'justify-center fixed inset-0 z-[100] bg-black m-0 p-0' : ''}`}>
            <div ref={viewerContainerRef} className={`w-full max-w-5xl bg-black overflow-hidden shadow-xl border border-slate-800 relative flex-col flex items-center justify-center group ${isFullscreen ? 'rounded-none border-none h-full w-full max-w-none' : 'aspect-video rounded-2xl'}`}>
              
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline 
                  style={{ 
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: (rotation % 180 !== 0) && isFullscreen ? '100vh' : '100%',
                    height: (rotation % 180 !== 0) && isFullscreen ? '100vw' : '100%',
                    transform: `translate(-50%, -50%) rotate(${rotation}deg) ${(rotation % 180 !== 0) && !isFullscreen ? 'scale(0.5625)' : 'scale(1)'}`, 
                    transition: 'all 0.3s ease',
                    maxWidth: 'none',
                    maxHeight: 'none'
                  }}
                  className="object-contain bg-black z-10 pointer-events-auto"
                />
              </div>

              <div className="absolute z-0 text-slate-500 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p>Establishing secure connection...</p>
              </div>
              
              <div className={`absolute bottom-6 right-6 z-20 flex flex-col gap-3 transition-opacity ${isFullscreen ? 'bottom-8 right-8' : 'opacity-80 hover:opacity-100'}`}>
                <button 
                  onClick={toggleRotation}
                  className="bg-white/90 hover:bg-white text-slate-900 font-semibold p-3 rounded-full shadow-2xl backdrop-blur-sm transition-all hover:scale-110 active:scale-90 flex items-center justify-center"
                  title="Rotate Video"
                >
                  <RotateCw className="w-5 h-5" />
                </button>
                <button 
                  onClick={extractText}
                  disabled={isExtracting}
                  className="bg-white/90 hover:bg-white text-slate-900 font-semibold p-3 rounded-full shadow-2xl backdrop-blur-sm transition-all hover:scale-110 active:scale-90 flex items-center justify-center disabled:opacity-70 disabled:hover:scale-100"
                  title="Extract Text"
                >
                  {isExtracting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : extractSuccess ? (
                    <Check className="w-5 h-5 text-green-600" />
                  ) : (
                    <ScanText className="w-5 h-5" />
                  )}
                </button>
                <button 
                  onClick={toggleRecording}
                  className={`font-semibold p-3 rounded-full shadow-2xl backdrop-blur-sm transition-all hover:scale-110 active:scale-90 flex items-center justify-center ${isRecording ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-white/90 hover:bg-white text-slate-900'}`}
                  title={isRecording ? "Stop Recording" : "Start Recording"}
                >
                  {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Video className="w-5 h-5" />}
                </button>
                <button 
                  onClick={takeScreenshot}
                  className="bg-white/90 hover:bg-white text-slate-900 font-semibold p-3 rounded-full shadow-2xl backdrop-blur-sm transition-all hover:scale-110 active:scale-90 flex items-center justify-center"
                  title="Capture Screenshot"
                >
                  <MonitorUp className="w-5 h-5" />
                  <span className="sr-only">Screenshot</span>
                </button>
                <button 
                  onClick={toggleFullscreen}
                  className="bg-white/90 hover:bg-white text-slate-900 font-semibold p-3 rounded-full shadow-2xl backdrop-blur-sm transition-all hover:scale-110 active:scale-90 flex items-center justify-center"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {!isFullscreen && (
              <button 
                onClick={handleStopWatching}
                className="mt-8 bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-10 rounded-full transition-colors shadow-lg active:scale-95"
              >
                Leave Broadcast
              </button>
            )}

            {isFullscreen && (
               <button 
                onClick={handleStopWatching}
                className="absolute top-6 left-6 z-[110] bg-red-600/90 hover:bg-red-600 text-white font-medium py-2 px-6 rounded-full transition-colors shadow-lg active:scale-95 backdrop-blur-sm"
              >
                Leave
              </button>
            )}
          </div>
        )}

        {!role && (
          <div className="flex flex-col gap-4 mt-8">
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 flex flex-col sm:flex-row items-start gap-4 shadow-sm">
              <div className="text-indigo-600 mt-1 shrink-0">
                <Info className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-indigo-900 mb-2">Can two websites screenshare the same device at one time?</h3>
                <p className="text-indigo-800/80 leading-relaxed text-sm">
                  <strong>Yes!</strong> Browsers allow multiple separate requests for screen capture. Each tab or website acts independently. If you start a broadcast here and then open another tool in a different tab to record your screen, your OS/browser will simply show you two separate prompts. You can choose to share the same content with both.
                </p>
              </div>
            </div>
            
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex flex-col sm:flex-row items-start gap-4 shadow-sm">
              <div className="text-amber-600 mt-1 shrink-0">
                <Info className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-900 mb-2">Can I share my screen from a mobile device?</h3>
                <p className="text-amber-800/80 leading-relaxed text-sm">
                  <strong>No, generally not.</strong> Mobile browsers like Chrome on Android or Safari on iOS restrict screen sharing capabilities. You can <strong>view</strong> a shared screen on mobile just fine, but starting a broadcast requires a desktop browser.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
