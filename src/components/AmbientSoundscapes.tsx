import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Volume2, Play, Pause, VolumeX, Music, Plus, Trash2, 
  Shuffle, Repeat, SkipForward, SkipBack, Youtube, Link, 
  Upload, Disc, Check, AlertCircle, Globe, ExternalLink, HelpCircle, Eye, EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playClick } from '../lib/audio';
import { db } from '../lib/firebase';
import { 
  collection, onSnapshot, addDoc, deleteDoc, doc, 
  query, orderBy, getDocs, limit, Timestamp 
} from 'firebase/firestore';

// Define music track interface
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  source: 'mp3' | 'youtube' | 'spotify' | 'upload';
  url: string;
  fileName?: string;
  createdAt: any;
}

// Default seed tracks in case Firestore is empty
const SEED_TRACKS = [
  {
    title: "Lofi Cafe Chill Beats",
    artist: "Lofi Girl Studio",
    source: "youtube" as const,
    url: "https://www.youtube.com/watch?v=jfKfPfyJRdk"
  },
  {
    title: "Đêm Mưa Hà Nội (Rain & Gentle Piano)",
    artist: "Thư Giãn Cổ Điển",
    source: "mp3" as const,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
  },
  {
    title: "Sóng Biển Bình Yên (Ocean Waves Sleep)",
    artist: "Nature Ambient Sounds",
    source: "mp3" as const,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3"
  },
  {
    title: "Deep Focus Space Ambient (Theta Brainwaves)",
    artist: "Meditation Music Therapy",
    source: "mp3" as const,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"
  },
  {
    title: "Chopin Nocturne Op. 9 No. 2 (Chopin Piano)",
    artist: "Arthur Rubinstein",
    source: "spotify" as const,
    url: "https://open.spotify.com/track/97Cc1g8BcoSstbF81S064S"
  }
];

// Helper to extract YouTube video ID
function getYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Helper to format Spotify embed URL
function getSpotifyEmbedUrl(url: string): string | null {
  const match = url.match(/spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
  if (match) {
    const type = match[1];
    const id = match[2];
    return `https://open.spotify.com/embed/${type}/${id}`;
  }
  return null;
}

// Helper to extract clean filename
function getCleanFileName(url: string): string {
  try {
    const parts = url.split('/');
    return parts[parts.length - 1].split('?')[0];
  } catch (e) {
    return "music.mp3";
  }
}

// IndexedDB Helper functions for persistent offline file upload storage
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AmbientMusicPlayerDB', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('local_music_files')) {
        database.createObjectStore('local_music_files');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveFileToDB = async (id: string, file: File): Promise<void> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('local_music_files', 'readwrite');
    const store = tx.objectStore('local_music_files');
    const request = store.put(file, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getFileFromDB = async (id: string): Promise<File | null> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('local_music_files', 'readonly');
    const store = tx.objectStore('local_music_files');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const deleteFileFromDB = async (id: string): Promise<void> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('local_music_files', 'readwrite');
    const store = tx.objectStore('local_music_files');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export default function AmbientSoundscapes() {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.5);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  
  // Playback Modes: shuffle, repeatMode ('off' | 'all' | 'one')
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('all');
  
  // MP3 State Management
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);
  const [isFallbackActive, setIsFallbackActive] = useState<boolean>(false);
  
  // YouTube State Management
  const [showVideo, setShowVideo] = useState<boolean>(true);
  
  // Admin Authorization states
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isDemoAdmin, setIsDemoAdmin] = useState<boolean>(false);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  
  // Admin additions fields
  const [newTitle, setNewTitle] = useState<string>('');
  const [newArtist, setNewArtist] = useState<string>('');
  const [newSource, setNewSource] = useState<'mp3' | 'youtube' | 'spotify' | 'upload'>('mp3');
  const [newUrl, setNewUrl] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  
  // Element refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const isDraggingProgress = useRef<boolean>(false);

  // Active track helper
  const activeTrack = tracks[currentTrackIndex] || null;

  // Check if current user is admin in payroll session
  useEffect(() => {
    const checkSession = () => {
      try {
        const saved = localStorage.getItem('payroll_session');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.role === 'admin') {
            setIsAdmin(true);
            return;
          }
        }
        setIsAdmin(false);
      } catch (e) {
        setIsAdmin(false);
      }
    };
    
    checkSession();
    window.addEventListener('storage', checkSession);
    return () => window.removeEventListener('storage', checkSession);
  }, []);

  // Listen to Firestore real-time music database
  useEffect(() => {
    const q = query(collection(db, 'music_tracks'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetchedTracks: MusicTrack[] = [];
      snapshot.forEach((docSnap) => {
        fetchedTracks.push({
          id: docSnap.id,
          ...docSnap.data()
        } as MusicTrack);
      });

      if (fetchedTracks.length === 0) {
        // If Firestore playlist is completely empty, seed standard tracks
        console.log("Seeding default relaxing music tracks to Firestore...");
        try {
          for (const trackToSeed of SEED_TRACKS) {
            await addDoc(collection(db, 'music_tracks'), {
              ...trackToSeed,
              createdAt: Timestamp.now()
            });
          }
        } catch (seedError) {
          console.error("Failed to seed default tracks:", seedError);
        }
      } else {
        setTracks(fetchedTracks);
      }
    }, (error) => {
      console.error("Firestore music track load error: ", error);
    });

    return () => unsubscribe();
  }, []);

  // Play next track handler
  const handleNextTrack = useCallback(() => {
    if (tracks.length === 0) return;
    
    if (repeatMode === 'one') {
      // Re-trigger current track
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      return;
    }

    if (shuffle) {
      // Choose random index
      const randIdx = Math.floor(Math.random() * tracks.length);
      setCurrentTrackIndex(randIdx);
    } else {
      // Choose next index sequential
      const nextIdx = currentTrackIndex + 1;
      if (nextIdx >= tracks.length) {
        if (repeatMode === 'all') {
          setCurrentTrackIndex(0);
        } else {
          setIsPlaying(false);
        }
      } else {
        setCurrentTrackIndex(nextIdx);
      }
    }
    setCurrentTime(0);
  }, [tracks, currentTrackIndex, shuffle, repeatMode]);

  // Play previous track handler
  const handlePrevTrack = useCallback(() => {
    if (tracks.length === 0) return;

    if (shuffle) {
      const randIdx = Math.floor(Math.random() * tracks.length);
      setCurrentTrackIndex(randIdx);
    } else {
      const prevIdx = currentTrackIndex - 1;
      if (prevIdx < 0) {
        if (repeatMode === 'all') {
          setCurrentTrackIndex(tracks.length - 1);
        } else {
          // Go to start of first track
          if (audioRef.current) audioRef.current.currentTime = 0;
        }
      } else {
        setCurrentTrackIndex(prevIdx);
      }
    }
    setCurrentTime(0);
  }, [tracks, currentTrackIndex, shuffle, repeatMode]);

  // Handle uploaded track file checking
  useEffect(() => {
    let active = true;
    if (!activeTrack) return;

    // Clean up any previously created object URL
    if (localFileUrl) {
      URL.revokeObjectURL(localFileUrl);
      setLocalFileUrl(null);
    }
    setIsFallbackActive(false);

    if (activeTrack.source === 'upload') {
      // Attempt to load from IndexedDB
      getFileFromDB(activeTrack.id)
        .then((file) => {
          if (!active) return;
          if (file) {
            const objectUrl = URL.createObjectURL(file);
            setLocalFileUrl(objectUrl);
          } else {
            // File not in IndexedDB (likely playing from a different machine)
            // Activate beautiful public fallback track
            console.log("Local binary file not found, playing premium ambient fallback.");
            setIsFallbackActive(true);
          }
        })
        .catch((err) => {
          console.error("IndexedDB load failure: ", err);
          if (active) setIsFallbackActive(true);
        });
    }

    return () => {
      active = false;
    };
  }, [activeTrack, tracks]);

  // Keep volume updated on <audio>
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Control playback on <audio> when track or isPlaying state changes
  useEffect(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      // Delay play execution slightly to allow browser audio unlock/ready state
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((e) => {
          console.warn("Autoplay / Audio start blocked or interrupted: ", e);
          setIsPlaying(false);
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, activeTrack, localFileUrl, isFallbackActive]);

  // Listen to postMessage communication from YouTube iframe player
  useEffect(() => {
    const handleYTMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && data.event === 'infoDelivery' && data.info) {
          // Check playerState: 0 is ENDED
          if (data.info.playerState === 0) {
            handleNextTrack();
          }
        }
      } catch (e) {
        // Safe skip non-JSON or unrelated messages
      }
    };

    window.addEventListener('message', handleYTMessage);
    return () => window.removeEventListener('message', handleYTMessage);
  }, [handleNextTrack]);

  // Procedural Canvas Waves Visualizer (calming, smooth, fully CORS-proof)
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let animationId: number;

    let phase = 0;

    const drawWaves = () => {
      animationId = requestAnimationFrame(drawWaves);
      
      // Clear with very slight transparency to leave elegant light trailing
      const isDark = document.documentElement.classList.contains('dark');
      ctx.fillStyle = isDark ? 'rgba(28, 28, 26, 0.12)' : 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!isPlaying || (activeTrack && activeTrack.source === 'spotify')) {
        // Draw flat line or slow micro wave if idle
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = isDark ? '#3d3d3a' : '#e4e4db';
        ctx.stroke();
        return;
      }

      // Draw multiple elegant layered sine wave lines
      const waveCount = 3;
      const colors = isDark 
        ? ['rgba(217, 119, 6, 0.5)', 'rgba(245, 158, 11, 0.3)', 'rgba(251, 191, 36, 0.15)'] // Warm amber palette
        : ['rgba(217, 119, 6, 0.5)', 'rgba(22, 163, 74, 0.35)', 'rgba(37, 99, 235, 0.15)'];  // Multi-color calming palette

      phase += 0.04;

      for (let w = 0; w < waveCount; w++) {
        ctx.beginPath();
        ctx.lineWidth = w === 0 ? 3 : 1.5;
        ctx.strokeStyle = colors[w];

        const amplitudeFactor = (w === 0 ? 25 : w === 1 ? 15 : 10) * (0.8 + Math.sin(phase * 1.5) * 0.2);
        
        for (let x = 0; x < canvas.width; x++) {
          const wavelength = w === 0 ? 0.012 : w === 1 ? 0.02 : 0.008;
          const y = canvas.height / 2 + Math.sin(x * wavelength + phase * (w + 1) * 0.6) * amplitudeFactor * (Math.sin(x / canvas.width * Math.PI));
          
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    };

    drawWaves();
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying, activeTrack]);

  // Dynamic digital timeline slider change
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  // Human readable time formatter
  const formatTime = (timeInSecs: number) => {
    if (isNaN(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Adding music track form submission
  const handleAddTrackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playClick();

    if (!newTitle.trim() || !newArtist.trim()) {
      alert("Vui lòng điền tiêu đề bài hát và tên nghệ sĩ.");
      return;
    }

    if (newSource !== 'upload' && !newUrl.trim()) {
      alert("Vui lòng cung cấp link liên kết (YouTube, Spotify, hoặc MP3).");
      return;
    }

    if (newSource === 'upload' && !uploadFile) {
      alert("Vui lòng chọn hoặc kéo thả một file MP3 để tải lên.");
      return;
    }

    setIsAdding(true);
    setUploadProgress('Đang thiết lập dữ liệu...');

    try {
      let finalUrl = newUrl.trim();
      let fileToStore: File | null = null;

      if (newSource === 'upload' && uploadFile) {
        fileToStore = uploadFile;
        // Local name reference
        finalUrl = `local-upload://${Date.now()}-${uploadFile.name}`;
      }

      // 1. Create document mapping in firestore
      const trackDoc = await addDoc(collection(db, 'music_tracks'), {
        title: newTitle.trim(),
        artist: newArtist.trim(),
        source: newSource,
        url: finalUrl,
        fileName: uploadFile ? uploadFile.name : null,
        createdAt: Timestamp.now()
      });

      // 2. If it is an upload, store the binary payload locally in IndexedDB
      if (newSource === 'upload' && fileToStore && trackDoc.id) {
        setUploadProgress('Đang nén và lưu file vào kho IndexedDB offline...');
        await saveFileToDB(trackDoc.id, fileToStore);
      }

      // Success Reset
      setNewTitle('');
      setNewArtist('');
      setNewUrl('');
      setUploadFile(null);
      setUploadProgress('');
      alert("Đã thêm nhạc mới vào danh sách thành công!");
    } catch (err: any) {
      console.error("Error adding music track: ", err);
      alert("Đã xảy ra lỗi khi thêm nhạc: " + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  // Drag and drop uploaded files helper
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/')) {
        setUploadFile(file);
        if (!newTitle) setNewTitle(file.name.replace(/\.[^/.]+$/, ""));
      } else {
        alert("Chỉ chấp nhận file định dạng âm thanh (.mp3, .wav, .m4a, etc)");
      }
    }
  };

  // Track deletion handler
  const handleDeleteTrack = async (trackId: string, trackTitle: string) => {
    if (!confirm(`Bạn chắc chắn muốn xóa bài hát "${trackTitle}" khỏi danh sách?`)) return;
    playClick();

    try {
      // Delete document
      await deleteDoc(doc(db, 'music_tracks', trackId));
      
      // Delete local file storage
      await deleteFileFromDB(trackId);

      // Adjust track pointer if deleted playing track
      if (activeTrack && activeTrack.id === trackId) {
        setIsPlaying(false);
        setCurrentTrackIndex(0);
      }
      alert("Đã xóa bài hát khỏi danh sách.");
    } catch (err) {
      console.error("Deletion error: ", err);
      alert("Không thể xóa bài hát: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div id="relaxing-music-player" className="p-6 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl shadow-xs space-y-6">
      
      {/* HTML5 Audio Node */}
      {activeTrack && (activeTrack.source === 'mp3' || activeTrack.source === 'upload') && (
        <audio
          ref={audioRef}
          src={isFallbackActive ? "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" : (localFileUrl || activeTrack.url)}
          onEnded={handleNextTrack}
          onTimeUpdate={() => {
            if (audioRef.current && !isDraggingProgress.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          }}
        />
      )}

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#f2f2ee] dark:border-[#2c2c28]">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-amber-600 font-bold flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5" />
            Nhạc Thư Giãn Bản Quyền
          </span>
          <h3 className="text-base font-bold tracking-tight text-[#1c1c1a] dark:text-[#fbfbfa]">
            Trình Phát Nhạc Thiền & Chill Tập Trung
          </h3>
          <p className="text-xs text-[#8c8c80] dark:text-[#acaca0] font-mono mt-0.5">
            Phát luân phiên • Không quảng cáo • Tùy biến nhạc nền
          </p>
        </div>

        {/* Demo Admin Trigger and Panel toggle */}
        <div className="flex items-center space-x-2 self-start sm:self-center">
          <button
            onClick={() => {
              playClick();
              setIsDemoAdmin(!isDemoAdmin);
            }}
            className={`px-3 py-1.5 rounded-xl border text-[11px] font-mono font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              isDemoAdmin 
                ? 'bg-amber-100 text-amber-800 border-amber-300' 
                : 'bg-[#fbfbfa] dark:bg-[#121211] text-[#5c5c54] dark:text-[#acaca0] border-[#e4e4db] dark:border-[#2c2c28] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28]'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isDemoAdmin ? 'bg-amber-500 animate-ping' : 'bg-gray-400'}`} />
            Demo Admin: {isDemoAdmin ? "BẬT" : "TẮT"}
          </button>

          {(isAdmin || isDemoAdmin) && (
            <button
              onClick={() => {
                playClick();
                setShowAdminPanel(!showAdminPanel);
              }}
              className="px-3 py-1.5 bg-[#1c1c1a] dark:bg-white text-white dark:text-[#1c1c1a] rounded-xl text-[11px] font-semibold transition-all cursor-pointer shadow-xs hover:opacity-90"
            >
              {showAdminPanel ? "Ẩn Bảng Thêm Nhạc" : "Thêm nhạc..."}
            </button>
          )}
        </div>
      </div>

      {/* Admin Panel (collapsible) */}
      <AnimatePresence>
        {showAdminPanel && (isAdmin || isDemoAdmin) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border border-dashed border-amber-400/40 bg-amber-500/5 dark:bg-amber-500/[0.02] p-4 rounded-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-amber-500/10 pb-2">
              <h4 className="text-xs font-bold font-mono text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                Bảng quản trị viên: Thêm bài hát mới vào cơ sở dữ liệu
              </h4>
              <span className="text-[10px] font-mono text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5 rounded">
                Admin Panel Active
              </span>
            </div>

            <form onSubmit={handleAddTrackSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Form Inputs */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#5c5c54] dark:text-[#acaca0] mb-1 font-mono">
                    Tên bài hát *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Relaxing Rain, Chill Instrumental..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-xs text-[#1c1c1a] dark:text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#5c5c54] dark:text-[#acaca0] mb-1 font-mono">
                    Nghệ sĩ / Nguồn sản xuất *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Chilled Beats, Studio Ghibli, Lofi..."
                    value={newArtist}
                    onChange={(e) => setNewArtist(e.target.value)}
                    className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] px-3 py-2 rounded-xl text-xs text-[#1c1c1a] dark:text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#5c5c54] dark:text-[#acaca0] mb-1 font-mono">
                    Nguồn bài hát (Source Type)
                  </label>
                  <div className="grid grid-cols-4 gap-1.5 p-1 bg-[#f2f2ee] dark:bg-[#121211] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl text-[10px] font-bold">
                    {(['mp3', 'youtube', 'spotify', 'upload'] as const).map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => {
                          playClick();
                          setNewSource(src);
                          setNewUrl('');
                          setUploadFile(null);
                        }}
                        className={`py-1.5 rounded-lg text-center cursor-pointer transition-all uppercase tracking-wide ${
                          newSource === src 
                            ? 'bg-amber-600 text-white shadow-xs' 
                            : 'text-[#5c5c54] dark:text-[#acaca0] hover:bg-[#e4e4db] dark:hover:bg-[#1c1c1a]'
                        }`}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Form Inputs based on Source */}
              <div className="space-y-3 flex flex-col justify-between">
                {newSource !== 'upload' ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-[#5c5c54] dark:text-[#acaca0] mb-1 font-mono flex items-center justify-between">
                      <span>Đường dẫn link (URL) *</span>
                      <span className="text-[9px] text-amber-600 lowercase font-bold font-sans">
                        {newSource === 'youtube' && "youtube.com/watch?v=..."}
                        {newSource === 'spotify' && "spotify.com/track/..."}
                        {newSource === 'mp3' && "đường dẫn file .mp3 trực tiếp"}
                      </span>
                    </label>
                    <div className="relative">
                      {newSource === 'youtube' ? <Youtube className="absolute left-3 top-2.5 w-4 h-4 text-red-500" /> : <Link className="absolute left-3 top-2.5 w-4 h-4 text-[#8c8c80]" />}
                      <input
                        type="url"
                        required
                        placeholder={
                          newSource === 'youtube' ? 'Nhập link YouTube...' :
                          newSource === 'spotify' ? 'Nhập link bài hát Spotify...' :
                          'Nhập link file MP3 online...'
                        }
                        value={newUrl}
                        onChange={(e) => setNewUrl(e.target.value)}
                        className="w-full bg-white dark:bg-[#121211] border border-[#c8c8c0] dark:border-[#2c2c28] pl-9 pr-3 py-2 rounded-xl text-xs text-[#1c1c1a] dark:text-white focus:outline-none"
                      />
                    </div>
                    
                    <p className="text-[10px] text-[#8c8c80] dark:text-[#acaca0] mt-2 leading-relaxed">
                      {newSource === 'youtube' && "Chúng tôi sẽ tự động trích xuất mã ID và nhúng trình phát video mượt mà, hỗ trợ tự động chuyển bài khi kết thúc."}
                      {newSource === 'spotify' && "Hỗ trợ nhúng Trình phát Spotify chính thức, đảm bảo nghe nhạc mượt mà không bị ngắt quãng."}
                      {newSource === 'mp3' && "Vui lòng sử dụng link tải trực tiếp chứa đuôi .mp3 (Direct URL) để hỗ trợ căn chỉnh dải sóng visualizer."}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-semibold text-[#5c5c54] dark:text-[#acaca0] mb-1 font-mono">
                      Kéo thả & Tải tệp MP3 lên máy (Lưu IndexedDB) *
                    </label>
                    
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleFileDrop}
                      onClick={() => document.getElementById('music-file-picker')?.click()}
                      className="border-2 border-dashed border-[#c8c8c0] dark:border-[#2c2c28] hover:border-amber-500 dark:hover:border-amber-500 rounded-xl p-5 text-center cursor-pointer transition-all bg-white dark:bg-[#121211]"
                    >
                      <input
                        id="music-file-picker"
                        type="file"
                        accept="audio/mp3,audio/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            setUploadFile(file);
                            if (!newTitle) setNewTitle(file.name.replace(/\.[^/.]+$/, ""));
                          }
                        }}
                      />
                      <Upload className="w-6 h-6 mx-auto text-[#8c8c80] animate-bounce mb-1.5" />
                      <p className="text-[11px] font-bold text-[#1c1c1a] dark:text-white">
                        {uploadFile ? uploadFile.name : "Kéo thả file nhạc vào đây hoặc Click để chọn"}
                      </p>
                      <p className="text-[9px] text-[#8c8c80] mt-1 font-mono">
                        {uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB • MP3 Audio` : "Dung lượng đề xuất dưới 20MB"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Submit button inside form */}
                <button
                  type="submit"
                  disabled={isAdding}
                  className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-semibold text-xs py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAdding ? "Đang xử lý tải nhạc..." : "Đăng tải & Đồng bộ Playlist"}</span>
                </button>
              </div>
            </form>

            {uploadProgress && (
              <div className="p-2 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-[10px] font-mono rounded flex items-center gap-1.5 animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{uploadProgress}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Music Player Screen Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Dynamic Display Card & Control Controls */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 bg-[#fbfbfa] dark:bg-[#121211] border border-[#f2f2ee] dark:border-[#2c2c28] rounded-2xl flex flex-col items-center justify-center relative min-h-[280px]">
            
            {/* Ambient Background Wave SVG */}
            <div className="absolute inset-0 overflow-hidden rounded-2xl opacity-10 dark:opacity-[0.03] pointer-events-none">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                <path d="M0,50 Q25,80 50,50 T100,50 L100,100 L0,100 Z" fill="currentColor" className="text-amber-600" />
              </svg>
            </div>

            {/* Source Display Logic */}
            {activeTrack ? (
              <div className="w-full flex flex-col items-center space-y-4 z-10">
                {activeTrack.source === 'youtube' ? (
                  // YouTube Video Monitor Container
                  <div className="w-full flex flex-col items-center space-y-2">
                    {showVideo ? (
                      <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[#e4e4db] dark:border-[#2c2c28] shadow-md relative">
                        <iframe
                          id="yt-player"
                          src={`https://www.youtube.com/embed/${getYouTubeId(activeTrack.url)}?autoplay=${isPlaying ? 1 : 0}&enablejsapi=1&origin=${window.location.origin}&controls=1&showinfo=0&rel=0`}
                          title={activeTrack.title}
                          className="w-full h-full border-0 absolute inset-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      // Play in background (hidden iframe but running to emit audio)
                      <div className="w-0 h-0 opacity-0 pointer-events-none absolute">
                        <iframe
                          src={`https://www.youtube.com/embed/${getYouTubeId(activeTrack.url)}?autoplay=${isPlaying ? 1 : 0}&enablejsapi=1&origin=${window.location.origin}`}
                          title={activeTrack.title}
                        />
                      </div>
                    )}

                    {/* Switch Video display trigger */}
                    <button
                      onClick={() => setShowVideo(!showVideo)}
                      className="text-[10px] font-mono text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-full font-bold flex items-center gap-1 cursor-pointer transition-all"
                    >
                      {showVideo ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showVideo ? "Ẩn khung màn hình YouTube" : "Hiện màn hình YouTube"}</span>
                    </button>
                  </div>
                ) : activeTrack.source === 'spotify' ? (
                  // Spotify Widget Container
                  <div className="w-full flex flex-col items-center space-y-4 py-6">
                    <div className="w-full max-w-sm rounded-xl overflow-hidden shadow-xs border border-green-500/10">
                      <iframe
                        src={getSpotifyEmbedUrl(activeTrack.url) || ""}
                        width="100%"
                        height="152"
                        frameBorder="0"
                        allowFullScreen
                        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        loading="lazy"
                        className="bg-transparent"
                      />
                    </div>
                    
                    <div className="p-3 bg-green-500/[0.04] border border-green-500/10 rounded-xl max-w-xs text-center space-y-1">
                      <p className="text-[10.5px] text-green-700 dark:text-green-400 font-bold flex items-center justify-center gap-1.5">
                        <Disc className="w-3.5 h-3.5 animate-spin" />
                        Liên kết Spotify Embed
                      </p>
                      <p className="text-[9px] text-[#8c8c80] leading-relaxed">
                        Nhấn nút phát trực tiếp trên thẻ widget xanh lá của Spotify phía trên để bắt đầu nghe nhạc.
                      </p>
                    </div>
                  </div>
                ) : (
                  // MP3 Audio View: spinning disk record
                  <div className="flex flex-col items-center space-y-3 py-2">
                    <div className="relative">
                      <motion.div
                        animate={isPlaying ? { rotate: 360 } : {}}
                        transition={isPlaying ? { repeat: Infinity, duration: 12, ease: "linear" } : {}}
                        className="w-32 h-32 rounded-full bg-zinc-900 border-4 border-zinc-700 flex items-center justify-center shadow-lg relative cursor-pointer"
                        onClick={() => setIsPlaying(!isPlaying)}
                      >
                        {/* Vinyl record grooves */}
                        <div className="absolute inset-2 border border-zinc-800 rounded-full" />
                        <div className="absolute inset-4 border border-zinc-800 rounded-full" />
                        <div className="absolute inset-6 border border-zinc-800 rounded-full" />
                        
                        {/* Center cover */}
                        <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center text-white text-[10px] font-mono font-bold border-2 border-zinc-900">
                          ZEN
                        </div>
                      </motion.div>

                      {/* Spinning arm indicator */}
                      <div className={`absolute top-0 -right-2 w-12 h-12 origin-top-left transform transition-transform duration-500 pointer-events-none ${
                        isPlaying ? 'rotate-12' : '-rotate-12'
                      }`}>
                        <svg viewBox="0 0 48 48" className="w-full h-full text-zinc-400 fill-current">
                          <path d="M4 4h4v16H4V4zm8 16h28l-4-4H12v4z" />
                        </svg>
                      </div>
                    </div>

                    {isFallbackActive && (
                      <span className="text-[9px] font-mono text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">
                        Đang phát nhạc mẫu dự phòng (File máy chủ)
                      </span>
                    )}
                  </div>
                )}

                {/* Track Details */}
                <div className="text-center space-y-1">
                  <h4 className="text-base font-bold text-[#1c1c1a] dark:text-white line-clamp-1 max-w-[280px]">
                    {activeTrack.title}
                  </h4>
                  <p className="text-xs text-[#5c5c54] dark:text-[#acaca0] font-mono">
                    {activeTrack.artist}
                  </p>
                </div>
              </div>
            ) : (
              // Empty list display
              <div className="text-center space-y-2">
                <Music className="w-10 h-10 text-zinc-400 mx-auto animate-pulse" />
                <p className="text-xs text-[#8c8c80] font-mono">Danh sách nhạc trống</p>
              </div>
            )}
          </div>

          {/* Timeline and Seek slider (Only for MP3 or Uploads) */}
          {activeTrack && (activeTrack.source === 'mp3' || activeTrack.source === 'upload') && (
            <div className="px-1 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#8c8c80]">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onMouseDown={() => { isDraggingProgress.current = true; }}
                onMouseUp={() => { isDraggingProgress.current = false; }}
                onChange={handleProgressChange}
                className="w-full accent-amber-600 h-1.5 bg-[#f2f2ee] dark:bg-[#2c2c28] rounded-lg appearance-none cursor-pointer"
                title="Thanh tua nhạc"
              />
            </div>
          )}

          {/* Media Controls Dashboard */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-[#fbfbfa] dark:bg-[#121211] border border-[#f2f2ee] dark:border-[#2c2c28] rounded-xl">
            
            {/* Playback Settings Group */}
            <div className="flex items-center space-x-3">
              {/* Shuffle toggle */}
              <button
                onClick={() => {
                  playClick();
                  setShuffle(!shuffle);
                }}
                title={shuffle ? "Đang bật phát trộn bài" : "Tắt trộn bài"}
                className={`p-2 rounded-lg border transition-all cursor-pointer ${
                  shuffle 
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-900/50' 
                    : 'bg-white dark:bg-[#1c1c1a] text-[#8c8c80] border-[#e4e4db] dark:border-[#2c2c28] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28]'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>

              {/* RepeatMode toggle */}
              <button
                onClick={() => {
                  playClick();
                  setRepeatMode(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
                }}
                title={
                  repeatMode === 'off' ? "Tắt tự động lặp bài" :
                  repeatMode === 'one' ? "Đang lặp lại 1 bài" : "Đang lặp lại toàn bộ"
                }
                className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center gap-1 text-xs font-mono font-bold ${
                  repeatMode !== 'off' 
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-900/50' 
                    : 'bg-white dark:bg-[#1c1c1a] text-[#8c8c80] border-[#e4e4db] dark:border-[#2c2c28] hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28]'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                {repeatMode === 'one' && <span className="text-[9px]">1</span>}
                {repeatMode === 'all' && <span className="text-[9px]">ALL</span>}
              </button>
            </div>

            {/* Previous, Play/Pause, Next Buttons */}
            <div className="flex items-center space-x-3.5">
              <button
                onClick={() => { playClick(); handlePrevTrack(); }}
                className="p-2.5 bg-white dark:bg-[#1c1c1a] text-[#1c1c1a] dark:text-white hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl transition-all cursor-pointer hover:scale-105 active:scale-95"
                title="Lùi bài"
              >
                <SkipBack className="w-4 h-4 fill-current" />
              </button>

              <button
                onClick={() => {
                  playClick();
                  setIsPlaying(!isPlaying);
                }}
                className="p-4 bg-amber-600 hover:bg-amber-700 text-white rounded-full transition-all shadow-md cursor-pointer hover:scale-105 active:scale-95"
                title={isPlaying ? "Tạm dừng" : "Bắt đầu phát"}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-white text-white" /> : <Play className="w-5 h-5 fill-white text-white ml-0.5" />}
              </button>

              <button
                onClick={() => { playClick(); handleNextTrack(); }}
                className="p-2.5 bg-white dark:bg-[#1c1c1a] text-[#1c1c1a] dark:text-white hover:bg-[#f2f2ee] dark:hover:bg-[#2c2c28] border border-[#e4e4db] dark:border-[#2c2c28] rounded-xl transition-all cursor-pointer hover:scale-105 active:scale-95"
                title="Bài tiếp theo"
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </button>
            </div>

            {/* Master Volume Controls */}
            <div className="flex items-center space-x-2.5 w-full sm:w-28 md:w-32">
              <button
                onClick={() => {
                  playClick();
                  setIsMuted(!isMuted);
                }}
                className="text-[#8c8c80] hover:text-[#1c1c1a] dark:hover:text-white transition-all cursor-pointer"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setIsMuted(false);
                }}
                className="flex-1 accent-amber-600 h-1 bg-[#f2f2ee] dark:bg-[#2c2c28] rounded-lg appearance-none cursor-pointer"
                title="Âm lượng trình phát"
              />
              <span className="text-[10px] font-mono text-[#8c8c80] w-6 text-right">
                {isMuted ? "0" : Math.round(volume * 100)}%
              </span>
            </div>
          </div>

          {/* Calm waves procedural Canvas Visualizer Screen */}
          <div className="h-16 bg-[#fbfbfa] dark:bg-[#121211] border border-[#f2f2ee] dark:border-[#2c2c28] rounded-xl overflow-hidden shadow-inner flex items-center justify-center">
            <canvas ref={canvasRef} width="480" height="64" className="w-full h-full" />
          </div>
        </div>

        {/* Right Side: Shared Interactive Playlist */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 bg-white dark:bg-[#1c1c1a]/90 border border-[#e4e4db] dark:border-[#2c2c28] rounded-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-[#f2f2ee] dark:border-[#2c2c28] pb-2">
              <h4 className="text-xs font-bold font-mono text-[#1c1c1a] dark:text-[#fbfbfa] uppercase tracking-wider">
                Danh sách bài hát ({tracks.length})
              </h4>
              <span className="text-[10px] font-mono text-[#8c8c80]">
                Click bài hát để phát
              </span>
            </div>

            {/* Scrollable track list */}
            <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
              {tracks.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#8c8c80] font-mono">
                  Đang tải danh sách bài hát từ máy chủ...
                </div>
              ) : (
                tracks.map((track, idx) => {
                  const isActive = currentTrackIndex === idx;
                  return (
                    <div
                      key={track.id}
                      onClick={() => {
                        playClick();
                        setCurrentTrackIndex(idx);
                        setIsPlaying(true);
                      }}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-2.5 ${
                        isActive
                          ? 'border-amber-500 bg-amber-500/[0.04] text-amber-700 dark:text-amber-400 font-bold'
                          : 'border-[#f2f2ee] dark:border-[#2c2c28] bg-transparent hover:bg-[#f2f2ee]/40 dark:hover:bg-[#121211]/40 text-[#5c5c54] dark:text-[#acaca0]'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        {/* Spinning indicator or status icon */}
                        {isActive && isPlaying ? (
                          <div className="flex items-end gap-0.5 h-3.5 w-3.5 shrink-0 pb-0.5">
                            <span className="w-0.5 bg-amber-600 animate-pulse h-2" style={{ animationDelay: '0.1s' }} />
                            <span className="w-0.5 bg-amber-600 animate-pulse h-3.5" style={{ animationDelay: '0.3s' }} />
                            <span className="w-0.5 bg-amber-600 animate-pulse h-1.5" style={{ animationDelay: '0.5s' }} />
                          </div>
                        ) : (
                          <Disc className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-600' : 'text-[#8c8c80]'}`} />
                        )}

                        <div className="min-w-0">
                          <p className={`text-xs truncate ${isActive ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-[#1c1c1a] dark:text-white'}`}>
                            {track.title}
                          </p>
                          <p className="text-[10px] text-[#8c8c80] dark:text-[#acaca0] font-mono truncate">
                            {track.artist}
                          </p>
                        </div>
                      </div>

                      {/* Right badge type & Delete action */}
                      <div className="flex items-center space-x-2 shrink-0">
                        {/* Source badges */}
                        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                          track.source === 'youtube' ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' :
                          track.source === 'spotify' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                          track.source === 'upload' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                        }`}>
                          {track.source}
                        </span>

                        {/* Admin Delete Action button */}
                        {(isAdmin || isDemoAdmin) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTrack(track.id, track.title);
                            }}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-all cursor-pointer"
                            title="Xóa khỏi danh sách"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
