import { OggOpusMuxer } from "./ogg-muxer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SceneOptimizer extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.scenesData = [];
        this.audioData = [];
        this.orphanedFiles = [];
        this.isOptimizing = false;

        // Progress state
        this.progress = { value: 0, max: 0, label: "" };

        // Tab state
        this.tabState = "scenes";
    }

    static DEFAULT_OPTIONS = {
        id: "geanos-scene-optimizer",
        tag: "form", // The app itself is the form
        window: {
            title: "Geano's Scene Optimizer",
            icon: "fas fa-magic",
            startWith: 700,
            contentClasses: ["scene-optimizer-window"]
        },
        position: {
            width: 700,
            height: "auto"
        },
        form: {
            handler: SceneOptimizer.prototype._onSubmit,
            closeOnSubmit: false
        },
        actions: {
            analyze: SceneOptimizer.prototype._onAnalyze,
            optimize: SceneOptimizer.prototype._onOptimizeClick,
            changeTab: SceneOptimizer.prototype._onChangeTab
        }
    };

    static PARTS = {
        form: {
            template: "modules/geanos-scene-optimizer/templates/optimizer.hbs"
        }
    };

    async _prepareContext(options) {
        // Refresh data if empty
        if (this.scenesData.length === 0) {
            this.scenesData = this._analyzeScenes();
        }
        if (this.audioData.length === 0) {
            this.audioData = this._analyzeAudio();
        }

        return {
            scenes: this.scenesData,
            audio: this.audioData,
            orphanedFiles: this.orphanedFiles,
            isOptimizing: this.isOptimizing,
            progressValue: this.progress.value,
            progressMax: this.progress.max,
            progressLabel: this.progress.label,
            // Context for tab state
            activeTab: this.tabState,
            isScenesTab: this.tabState === "scenes",
            isAudioTab: this.tabState === "audio"
        };
    }

    _onRender(context, options) {
        // Handle "Select All" checkboxes manually as they are UI-only interactions
        const html = this.element;

        const selectAllScenes = html.querySelector('#select-all-scenes');
        if (selectAllScenes) {
            selectAllScenes.addEventListener('change', (event) => {
                const checked = event.currentTarget.checked;
                const checkboxes = html.querySelectorAll(".tab[data-tab='scenes'] .scene-row.unoptimized input[type='checkbox']");
                checkboxes.forEach(cb => cb.checked = checked);
            });
        }

        const selectAllAudio = html.querySelector('#select-all-audio');
        if (selectAllAudio) {
            selectAllAudio.addEventListener('change', (event) => {
                const checked = event.currentTarget.checked;
                const checkboxes = html.querySelectorAll(".tab[data-tab='audio'] .scene-row.unoptimized input[type='checkbox']");
                checkboxes.forEach(cb => cb.checked = checked);
            });
        }

        // Slider Reactivity (Visual only)
        const rangeInput = html.querySelector('#quality-slider');
        const rangeDisplay = html.querySelector('#quality-display');
        if (rangeInput && rangeDisplay) {
            rangeInput.addEventListener('input', (event) => {
                rangeDisplay.textContent = event.target.value;
            });
        }
    }

    // --- Actions ---

    async _onChangeTab(event, target) {
        this.tabState = target.dataset.tab;
        this.render();
    }

    async _onAnalyze(event, target) {
        if (this.isOptimizing) return;
        this.scenesData = this._analyzeScenes();
        this.audioData = this._analyzeAudio();
        this.render();
    }

    async _onOptimizeClick(event, target) {
        // Prevent default form submission if triggered by button inside form
        event.preventDefault();

        if (this.isOptimizing) return;

        // Gather FormData using standard FormData API from the form element
        const formData = new FormData(this.element);

        // --- SCENES ---
        let selectedSceneIds = formData.getAll("sceneIds"); // getAll returns array

        // --- AUDIO ---
        let selectedAudioIds = formData.getAll("audioIds");

        // Filter based on active tab
        if (this.tabState === "scenes") selectedAudioIds = [];
        if (this.tabState === "audio") selectedSceneIds = [];

        if (selectedSceneIds.length === 0 && selectedAudioIds.length === 0) {
            return ui.notifications.warn("No items selected.");
        }

        const quality = parseFloat(formData.get("quality")) || 0.85;
        const audioBitrate = parseInt(formData.get("audioBitrateAudio")) || 128000;

        // Collect Objects
        const targetScenes = selectedSceneIds.map(id => game.scenes.get(id)).filter(s => s);
        // Map audio keys back to data objects
        const targetAudio = selectedAudioIds.map(key => this.audioData.find(a => a.uniqueId === key)).filter(a => a);

        this.isOptimizing = true;
        this.orphanedFiles = [];
        const totalItems = targetScenes.length + targetAudio.length;
        this.progress = { value: 0, max: totalItems, label: "Starting..." };
        this.render();

        // Small wait to allow render to update UI
        await new Promise(r => setTimeout(r, 100));

        // Process Scenes
        if (targetScenes.length > 0) {
            await this._runSceneOptimization(targetScenes, quality);
        }

        // Process Audio
        if (targetAudio.length > 0) {
            await this._runAudioOptimization(targetAudio, audioBitrate);
        }

        this.isOptimizing = false;
        this.progress.label = "Done!";
        this.progress.value = totalItems;
        this.render();
    }

    // Since we handle the optimize click manually, the submit handler might be redundant 
    // but good to have if we change button type to submit
    async _onSubmit(event, form, formData) {
        // No-op or delegate to optimize
        return;
    }

    // --- Logic Methods (Largely Unchanged) ---

    _analyzeScenes() {
        const scenes = game.scenes.contents;
        return scenes.map(scene => {
            const imgPath = scene.background.src || "";
            const decodedPath = decodeURIComponent(imgPath);
            const ext = decodedPath.split('.').pop().toLowerCase();
            const isOptimized = ["webp", "webm"].includes(ext);
            const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);

            let statusClass = "unknown";
            let checked = false;

            if (isImage) {
                if (isOptimized) {
                    statusClass = "optimized";
                } else {
                    statusClass = "unoptimized";
                    checked = true;
                }
            }

            return {
                id: scene.id,
                name: scene.name,
                path: decodedPath,
                format: ext,
                isOptimized: isOptimized,
                statusClass: statusClass,
                checked: checked
            };
        }).sort((a, b) => {
            if (a.statusClass === "unoptimized" && b.statusClass !== "unoptimized") return -1;
            if (a.statusClass !== "unoptimized" && b.statusClass === "unoptimized") return 1;
            return a.name.localeCompare(b.name);
        });
    }

    _analyzeAudio() {
        const audioItems = [];

        // 1. Scan Playlists
        game.playlists.contents.forEach(playlist => {
            playlist.sounds.contents.forEach(sound => {
                this._processAudioItem(audioItems, sound.path, sound.name, "Playlist", playlist.name, sound.id, playlist.id, "playlist");
            });
        });

        // 2. Scan Ambient Sounds in Scenes
        game.scenes.contents.forEach(scene => {
            scene.sounds.contents.forEach(sound => {
                this._processAudioItem(audioItems, sound.path, "Ambient Sound", "Scene", scene.name, sound.id, scene.id, "ambient");
            });
        });

        return audioItems.sort((a, b) => {
            if (a.statusClass === "unoptimized" && b.statusClass !== "unoptimized") return -1;
            if (a.statusClass !== "unoptimized" && b.statusClass === "unoptimized") return 1;
            return a.name.localeCompare(b.name);
        });
    }

    _processAudioItem(list, path, name, parentType, parentName, id, parentId, type) {
        if (!path) return;
        const decodedPath = decodeURIComponent(path);
        const ext = decodedPath.split('.').pop().toLowerCase();
        // WebM and OGG are considered "Optimized" for Foundry
        const isOptimized = ["webm", "ogg"].includes(ext);
        const isAudio = ["mp3", "wav", "flac", "ogg", "webm"].includes(ext);

        if (!isAudio) return;

        let statusClass = isOptimized ? "optimized" : "unoptimized";
        let checked = !isOptimized;

        list.push({
            uniqueId: `${type}|${parentId}|${id}`, // Unique Key
            type: type, // 'playlist' or 'ambient'
            parentId: parentId,
            id: id,
            name: name,
            parentName: parentName, // e.g. "Battle Music" or "Market Scene"
            path: decodedPath,
            format: ext,
            isOptimized: isOptimized,
            statusClass: statusClass,
            checked: checked
        });
    }

    async _runSceneOptimization(scenes, quality) {
        let completed = this.progress.value;
        const total = this.progress.max;

        for (const scene of scenes) {
            const labelText = `Optimizing Image: ${scene.name} (${completed + 1}/${total})`;
            this._updateProgress(completed, labelText);

            try {
                const originalPath = scene.background.src;
                const blob = await this._convertImageToWebP(originalPath, quality);

                if (blob && blob.size > 0) {
                    const decodedPath = decodeURIComponent(originalPath);
                    const pathParts = decodedPath.split("/");
                    const fileName = pathParts.pop();
                    const folderPath = pathParts.join("/");
                    const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf("."));
                    const newFileName = `${nameWithoutExt}.webp`;

                    const file = new File([blob], newFileName, { type: "image/webp" });
                    const result = await FilePicker.upload("data", folderPath, file);

                    const newPath = result.path || `${folderPath}/${newFileName}`;
                    await scene.update({ "background.src": newPath });

                    if (originalPath.split("?")[0] !== newPath.split("?")[0]) {
                        this.orphanedFiles.push(originalPath);
                    }
                }
            } catch (err) {
                console.error(`Scene Optimizer | Failed Scene ${scene.name}:`, err);
            }
            completed++;
            this._updateProgress(completed);
            await new Promise(r => setTimeout(r, 200)); // Delay for server kindness
        }
    }

    async _runAudioOptimization(audioItems, bitrate) {
        let completed = this.progress.value; // Continue from scenes
        const total = this.progress.max;

        // Check Support
        if (!window.AudioEncoder) {
            ui.notifications.error("Scene Optimizer | Your browser/Foundry version does not support AudioEncoder. Cannot optimize audio.");
            return;
        }

        // Context for decoding
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        for (const item of audioItems) {
            const labelText = `Converting Audio (${item.format} -> ogg): ${item.name} (${completed + 1}/${total})`;
            this._updateProgress(completed, labelText);

            try {
                // 1. Fetch
                const response = await fetch(item.path);
                const arrayBuffer = await response.arrayBuffer();

                // 2. Decode (Always needed)
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                // 3. Convert to OGG Opus (Fast)
                const blob = await this._convertAudioToOggFast(audioBuffer, bitrate, (pct) => {
                    this._updateProgress(completed, `Encoding ${item.name}: ${pct}%`);
                });

                if (blob && blob.size > 0) {
                    const pathParts = item.path.split("/");
                    const fileName = pathParts.pop();
                    const folderPath = pathParts.join("/");
                    const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf("."));
                    const newFileName = `${nameWithoutExt}.ogg`;

                    const file = new File([blob], newFileName, { type: "audio/ogg" });
                    const result = await FilePicker.upload("data", folderPath, file);

                    const newPath = result.path || `${folderPath}/${newFileName}`;

                    // 4. Update Foundry Object
                    if (item.type === 'playlist') {
                        const playlist = game.playlists.get(item.parentId);
                        const sound = playlist.sounds.get(item.id);
                        await sound.update({ path: newPath });
                    } else if (item.type === 'ambient') {
                        const scene = game.scenes.get(item.parentId);
                        const sound = scene.sounds.get(item.id);
                        await sound.update({ path: newPath });
                    }

                    if (item.path !== newPath) {
                        this.orphanedFiles.push(item.path);
                    }
                } else {
                    console.error("[SceneOptimizer] Blob was empty or null!");
                }
            } catch (err) {
                console.error(`Scene Optimizer | Failed Audio ${item.name}:`, err);
            }

            completed++;
            this._updateProgress(completed);

            // Pause slightly to let UI breathe
            await new Promise(r => setTimeout(r, 100));
        }

        if (audioCtx.state !== 'closed') audioCtx.close();
    }

    _updateProgress(value, label) {
        this.progress.value = value;
        if (label) this.progress.label = label;
        // ApplicationV2 re-renders are efficient, so we can just render key parts or the whole thing.
        // For smoother progress bars, direct DOM manipulation is still preferred to avoid full re-renders interrupting animations.
        const progressBar = this.element.querySelector("progress");
        const progressLabel = this.element.querySelector(".progress-container label");

        if (progressBar) progressBar.value = value;
        if (progressLabel && label) progressLabel.textContent = label;
    }

    /**
     * Converts AudioBuffer to OGG (Opus) using WebCodecs AudioEncoder (FAST).
     */
    async _convertAudioToOggFast(audioBuffer, bitrate = 128000, onProgress) {
        return new Promise(async (resolve, reject) => {
            try {
                const muxer = new OggOpusMuxer(audioBuffer.sampleRate, audioBuffer.numberOfChannels);
                let encodedChunks = 0;

                const encoder = new AudioEncoder({
                    output: (chunk, metadata) => {
                        const buffer = new Uint8Array(chunk.byteLength);
                        chunk.copyTo(buffer);
                        // Calculates frames (samples) roughly from duration
                        // chunk.duration is in microseconds.
                        const samples = Math.round(chunk.duration * audioBuffer.sampleRate / 1000000);
                        muxer.addPacket(buffer, samples);
                        encodedChunks++;
                    },
                    error: (e) => {
                        console.error("AudioEncoder Error:", e);
                        reject(e);
                    }
                });

                encoder.configure({
                    codec: 'opus',
                    numberOfChannels: audioBuffer.numberOfChannels,
                    sampleRate: audioBuffer.sampleRate,
                    bitrate: bitrate
                });

                const numberOfChannels = audioBuffer.numberOfChannels;
                const length = audioBuffer.length;
                const sampleRate = audioBuffer.sampleRate;

                // Chunk size ~5 seconds to reduce event loop pressure
                const chunkSize = sampleRate * 5;
                let offset = 0;

                while (offset < length) {
                    // Backpressure check
                    if (encoder.encodeQueueSize > 5) {
                        await new Promise(r => setTimeout(r, 10));
                        continue;
                    }

                    const end = Math.min(offset + chunkSize, length);
                    const frameLength = end - offset;
                    const timestamp = offset * 1000000 / sampleRate;

                    // Extract and interleave/planarize data
                    const buffer = new Float32Array(frameLength * numberOfChannels);
                    for (let ch = 0; ch < numberOfChannels; ch++) {
                        const channelData = audioBuffer.getChannelData(ch).subarray(offset, end);
                        buffer.set(channelData, ch * frameLength);
                    }

                    const audioData = new AudioData({
                        format: 'f32-planar',
                        sampleRate: sampleRate,
                        numberOfChannels: numberOfChannels,
                        numberOfFrames: frameLength,
                        timestamp: timestamp,
                        data: buffer
                    });

                    encoder.encode(audioData);
                    audioData.close();

                    offset += chunkSize;

                    // Progress update
                    if (onProgress) {
                        const pct = Math.round((offset / length) * 100);
                        onProgress(pct);
                    }

                    // Yield to event loop
                    await new Promise(r => setTimeout(r, 0));
                }

                await encoder.flush();
                const blob = muxer.getBlob();
                resolve(blob);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Loads an image from a URL, draws it to a canvas, and returns a WebP Blob.
     */
    async _convertImageToWebP(src, quality) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas toBlob failed"));
                }, "image/webp", quality);
            };
            img.onerror = (err) => reject(err);
            img.src = src;
        });
    }
}

Hooks.once("init", () => {
    console.log("Geano's Scene Optimizer | Initializing");
});

Hooks.on("getSceneDirectoryEntryContext", (html, options) => {
    options.push({
        name: "Scene Optimizer",
        icon: '<i class="fas fa-magic"></i>',
        condition: game.user.isGM,
        callback: li => {
            new SceneOptimizer().render(true);
        }
    });
});

Hooks.on("renderSceneDirectory", (app, html, data) => {
    if (!game.user.isGM) return;
    const button = document.createElement("button");
    button.classList.add("scene-optimizer-btn");
    button.innerHTML = `<i class="fas fa-magic"></i> Optimize Scenes`;
    button.onclick = () => {
        new SceneOptimizer().render(true);
    };

    // Support both standard Foundry sidebar and potential V13 variations if class names change
    const headerActions = html.querySelector(".header-actions");
    if (headerActions) {
        headerActions.appendChild(button);
    }
});
