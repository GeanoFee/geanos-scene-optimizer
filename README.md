# Geano's Scene Optimizer

**Geano's Scene Optimizer** is a powerful Foundry VTT module that optimizes your world's assets for maximum performance. It converts heavy background images to **WebP** and bulky audio files to efficient **OGG (Opus)**, significantly reducing load times and bandwidth usage for you and your players.


## ✨ Features

### 🎨 Scene Optimization (Images)
*   **Format Detection**: Identifies scenes using unoptimized formats (PNG, JPG, JPEG).
*   **WebP Conversion**: Converts backgrounds to highly efficient WebP format.
*   **Quality Control**: Adjustable quality slider (default 0.85) to balance size vs. fidelity.

### 🎵 Audio Optimization (Sound)
*   **Universal Scan**: Detects unoptimized audio in **Playlists** and **Ambient Sounds** (Scene-placed audio).
*   **Opus/OGG Conversion**: Transcodes audio to the modern, stream-friendly OGG Opus format.
*   **Native Acceleration**: Uses your browser's **WebCodecs** API for incredibly fast, multi-threaded offline processing—no external tools needed.
*   **Bitrate Control**: Selectable quality from **64kbps** (Voice) to **256kbps** (Music).

### 🛠️ General
*   **Non-Destructive**: Creates *new* optimized files alongside originals. Original files are safe and listed as "orphaned" for optional manual cleanup.
*   **Smart Filenaming**: Handles filenames with spaces and special characters perfectly.
*   **Progress Feedback**: Real-time progress bar with streaming updates for large files.

## 🚀 Installation

- **Manifest URL**: `https://github.com/GeanoFee/geanos-scene-optimizer/releases/latest/download/module.json` within Foundry's "Install Module" window.

## 🎮 Usage

1.  Navigate to the **Scenes Directory** sidebar.
2.  Click the **"Optimize Scenes"** button in the header (or right-click any Scene/Folder).
3.  The **Optimizer Window** opens with two tabs:
    *   **Scenes**: For background images.
    *   **Audio**: For playlist tracks and ambient sounds.
4.  **Select Items**: Check the boxes for items you wish to optimize (Red = Unoptimized).
5.  **Configure Settings**:
    *   *Image Quality*: Adjust the slider (0.1 - 1.0).
    *   *Audio Bitrate*: Select your desired bitrate (default 128kbps).
6.  Click **"Optimize Selected"**.
7.  **Wait**: A progress bar will show the conversion status. Large audio files may take a moment but will update in real-time.
8.  **Done**: Your world is now faster!

## 🔧 Technical Details

*   **Images**: Converted using HTML5 Canvas `toBlob("image/webp")`.
*   **Audio**: Converted using `AudioDecoder` -> `AudioEncoder` (Opus) -> `OggOpusMuxer` (Custom JS implementation).
*   **Streaming**: Audio is processed in chunks to prevent browser freezing, even for hour-long files.

---
## License
This module is licensed under the [MIT License](LICENSE).
