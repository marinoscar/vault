import { useState, useRef, useCallback, useEffect } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import SpeedIcon from '@mui/icons-material/Speed';
import Forward10Icon from '@mui/icons-material/Forward10';
import Replay10Icon from '@mui/icons-material/Replay10';
import MusicNoteIcon from '@mui/icons-material/MusicNote';

interface MediaPlayerProps {
  src: string;
  mode: 'video' | 'audio' | 'image';
  fileName?: string;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MediaPlayer({ src, mode, fileName }: MediaPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAudio = mode === 'audio';
  const isImage = mode === 'image';

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [skipIndicator, setSkipIndicator] = useState<'fwd' | 'back' | null>(null);
  const [speedAnchor, setSpeedAnchor] = useState<null | HTMLElement>(null);

  const media = mediaRef.current;

  // Auto-hide controls (video only)
  const resetHideTimer = useCallback(() => {
    if (isAudio || isImage) return;
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (mediaRef.current && !mediaRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, [isAudio, isImage]);

  // Media event handlers
  useEffect(() => {
    if (isImage) return;
    const el = mediaRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setShowControls(true);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onDurationChange = () => setDuration(el.duration);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);
    const onVolumeChange = () => {
      setVolume(el.volume);
      setMuted(el.muted);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('durationchange', onDurationChange);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('volumechange', onVolumeChange);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('durationchange', onDurationChange);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('volumechange', onVolumeChange);
    };
  }, [isImage]);

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
    resetHideTimer();
  }, [resetHideTimer]);

  const skip = useCallback(
    (seconds: number) => {
      const el = mediaRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + seconds));
      setSkipIndicator(seconds > 0 ? 'fwd' : 'back');
      setTimeout(() => setSkipIndicator(null), 600);
      resetHideTimer();
    },
    [resetHideTimer],
  );

  const handleSeek = useCallback(
    (_: Event | React.SyntheticEvent, value: number | number[]) => {
      const el = mediaRef.current;
      if (!el) return;
      el.currentTime = value as number;
      resetHideTimer();
    },
    [resetHideTimer],
  );

  const handleVolumeChange = useCallback(
    (_: Event | React.SyntheticEvent, value: number | number[]) => {
      const el = mediaRef.current;
      if (!el) return;
      const vol = value as number;
      el.volume = vol;
      el.muted = vol === 0;
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
  }, []);

  const setSpeed = useCallback((rate: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.playbackRate = rate;
    setPlaybackRate(rate);
    setSpeedAnchor(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen();
  }, []);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const zone = x / rect.width;
      if (zone < 0.3) skip(-10);
      else if (zone > 0.7) skip(10);
      else togglePlay();
    },
    [skip, togglePlay],
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (isImage) return;
    const handleKey = (e: KeyboardEvent) => {
      if (
        !containerRef.current?.contains(document.activeElement) &&
        document.activeElement !== document.body
      )
        return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (media) media.volume = Math.min(1, media.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (media) media.volume = Math.max(0, media.volume - 0.1);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          if (!isAudio) toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay, skip, toggleMute, toggleFullscreen, media, isAudio, isImage]);

  // Control bar (shared between video & audio)
  const controlBar = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0.5, sm: 1 },
        mt: isAudio ? 0 : -0.5,
      }}
    >
      <IconButton onClick={togglePlay} size="small" sx={{ color: 'white' }}>
        {playing ? <PauseIcon /> : <PlayArrowIcon />}
      </IconButton>

      <IconButton onClick={() => skip(-10)} size="small" sx={{ color: 'white' }}>
        <Replay10Icon fontSize="small" />
      </IconButton>

      <IconButton onClick={() => skip(10)} size="small" sx={{ color: 'white' }}>
        <Forward10Icon fontSize="small" />
      </IconButton>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton onClick={toggleMute} size="small" sx={{ color: 'white' }}>
          {muted || volume === 0 ? (
            <VolumeOffIcon fontSize="small" />
          ) : (
            <VolumeUpIcon fontSize="small" />
          )}
        </IconButton>
        <Slider
          size="small"
          value={muted ? 0 : volume}
          min={0}
          max={1}
          step={0.05}
          onChange={handleVolumeChange}
          sx={{
            width: { xs: 50, sm: 80 },
            color: 'white',
            '& .MuiSlider-thumb': { width: 10, height: 10 },
            '& .MuiSlider-rail': { bgcolor: 'rgba(255,255,255,0.3)' },
          }}
        />
      </Box>

      <Typography
        variant="caption"
        sx={{ color: 'white', mx: 1, whiteSpace: 'nowrap', userSelect: 'none' }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </Typography>

      <Box sx={{ flex: 1 }} />

      <IconButton
        onClick={(e) => setSpeedAnchor(e.currentTarget)}
        size="small"
        sx={{ color: 'white' }}
      >
        {playbackRate === 1 ? (
          <SpeedIcon fontSize="small" />
        ) : (
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'white' }}>
            {playbackRate}x
          </Typography>
        )}
      </IconButton>

      {!isAudio && (
        <IconButton onClick={toggleFullscreen} size="small" sx={{ color: 'white' }}>
          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      )}
    </Box>
  );

  const seekBar = (
    <Slider
      size="small"
      value={currentTime}
      min={0}
      max={duration || 1}
      onChange={handleSeek}
      sx={{
        color: 'primary.main',
        height: 4,
        p: '4px 0',
        '& .MuiSlider-thumb': {
          width: 12,
          height: 12,
          transition: 'width 0.15s, height 0.15s',
          '&:hover, &.Mui-focusVisible': { width: 16, height: 16 },
        },
        '& .MuiSlider-rail': { bgcolor: 'rgba(255,255,255,0.3)' },
      }}
    />
  );

  const speedMenu = (
    <Menu
      anchorEl={speedAnchor}
      open={Boolean(speedAnchor)}
      onClose={() => setSpeedAnchor(null)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {PLAYBACK_SPEEDS.map((rate) => (
        <MenuItem
          key={rate}
          selected={playbackRate === rate}
          onClick={() => setSpeed(rate)}
          dense
        >
          {rate === 1 ? 'Normal' : `${rate}x`}
        </MenuItem>
      ))}
    </Menu>
  );

  // Image mode
  if (isImage) {
    return (
      <Box
        ref={containerRef}
        sx={{
          bgcolor: '#000',
          borderRadius: 1,
          overflow: 'hidden',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          maxHeight: 'calc(100vh - 120px)',
        }}
      >
        <img
          src={src}
          alt={fileName ?? 'Media'}
          style={{
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 120px)',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </Box>
    );
  }

  // Audio mode
  if (isAudio) {
    return (
      <Box
        ref={containerRef}
        sx={{
          bgcolor: '#1a1a2e',
          borderRadius: 2,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={src}
          preload="metadata"
        />

        {/* Album art area */}
        <Box
          onClick={togglePlay}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            py: 4,
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              bgcolor: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.3s ease',
              animation: playing ? 'spin 4s linear infinite' : 'none',
              '@keyframes spin': {
                from: { transform: 'rotate(0deg)' },
                to: { transform: 'rotate(360deg)' },
              },
            }}
          >
            <MusicNoteIcon sx={{ fontSize: 36, color: 'primary.main' }} />
          </Box>

          {buffering && (
            <CircularProgress size={32} sx={{ color: 'white', position: 'absolute' }} />
          )}
        </Box>

        {fileName && (
          <Typography
            variant="body2"
            sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', px: 2, mb: 1 }}
            noWrap
          >
            {fileName}
          </Typography>
        )}

        {/* Controls */}
        <Box sx={{ px: 2, pb: 1.5 }}>
          {seekBar}
          {controlBar}
        </Box>

        {speedMenu}
      </Box>
    );
  }

  // Video mode
  return (
    <Box
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => {
        if (playing) setShowControls(false);
      }}
      sx={{
        position: 'relative',
        bgcolor: '#000',
        borderRadius: isFullscreen ? 0 : 1,
        overflow: 'hidden',
        cursor: showControls ? 'default' : 'none',
        '&:hover': { cursor: 'default' },
        width: '100%',
      }}
    >
      <Box
        onClick={handleVideoClick}
        sx={{ position: 'relative', width: '100%', cursor: 'pointer' }}
      >
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={src}
          preload="metadata"
          playsInline
          style={{
            width: '100%',
            display: 'block',
            maxHeight: isFullscreen ? '100vh' : 'calc(100vh - 120px)',
            objectFit: 'contain',
          }}
        />
      </Box>

      {buffering && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={48} sx={{ color: 'white' }} />
        </Box>
      )}

      {skipIndicator && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: skipIndicator === 'back' ? '15%' : undefined,
            right: skipIndicator === 'fwd' ? '15%' : undefined,
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            animation: 'fadeInOut 0.6s ease',
            '@keyframes fadeInOut': {
              '0%': { opacity: 0, transform: 'translateY(-50%) scale(0.8)' },
              '30%': { opacity: 1, transform: 'translateY(-50%) scale(1)' },
              '100%': { opacity: 0, transform: 'translateY(-50%) scale(1.2)' },
            },
          }}
        >
          {skipIndicator === 'back' ? (
            <Replay10Icon
              sx={{ fontSize: 48, color: 'white', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
            />
          ) : (
            <Forward10Icon
              sx={{ fontSize: 48, color: 'white', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
            />
          )}
        </Box>
      )}

      {!playing && !buffering && (
        <Box
          onClick={togglePlay}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            bgcolor: 'rgba(0,0,0,0.6)',
            borderRadius: '50%',
            width: 64,
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.15s ease',
            '&:hover': {
              transform: 'translate(-50%, -50%) scale(1.1)',
              bgcolor: 'rgba(0,0,0,0.75)',
            },
          }}
        >
          <PlayArrowIcon sx={{ fontSize: 40, color: 'white' }} />
        </Box>
      )}

      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
          pt: 4,
          pb: 1,
          px: { xs: 1, sm: 2 },
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        {seekBar}
        {controlBar}
      </Box>

      {speedMenu}
    </Box>
  );
}
