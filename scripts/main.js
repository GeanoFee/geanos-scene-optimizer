import { OggOpusMuxer } from "./ogg-muxer.js";

class SceneOptimizer extends FormApplication {
    constructor() {
        super();
        this.scenesData = [];
        this.audioData = []; // New Store for audio
        this.orphanedFiles = [];
        this.isOptimizing = false;
        this.progress = { value: 0, max: 0, label: "" };
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "geanos-scene-optimizer",
            title: "Geano's Scene Optimizer",
            template: "modules/geanos-scene-optimizer/templates/optimizer.hbs",
            width: 700, // Slightly wider for tabs
            height: "auto",
            resizable: true,
            closeOnSubmit: false,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: "form", initial: "scenes" }] // Activate Tabs
        });
    }

    async getData() {
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
            progressLabel: this.progress.label
        };
    }

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

    activateListeners(html) {
        super.activateListeners(html);
        html.find('button[data-action="analyze"]').click(this._onAnalyze.bind(this));
        html.find('button[data-action="optimize"]').click(this._onOptimizeClick.bind(this));
        html.find('#select-all-scenes').change(this._onSelectAllScenes.bind(this));
        html.find('#select-all-audio').change(this._onSelectAllAudio.bind(this));

        // Slider Reactivity
        html.find('#quality-slider').on('input change', (event) => {
            html.find('#quality-display').text(event.target.value);
        });

        // Tabs are handled automatically by FormApplication defaultOptions structure
    }

    _onSelectAllScenes(event) {
        const checked = event.currentTarget.checked;
        const rows = this.element.find(".tab[data-tab='scenes'] .scene-row.unoptimized input[type='checkbox']");
        rows.prop("checked", checked);
    }

    _onSelectAllAudio(event) {
        const checked = event.currentTarget.checked;
        const rows = this.element.find(".tab[data-tab='audio'] .scene-row.unoptimized input[type='checkbox']");
        rows.prop("checked", checked);
    }

    async _onAnalyze() {
        this.scenesData = this._analyzeScenes();
        this.audioData = this._analyzeAudio();
        this.render();
    }

    async _onOptimizeClick(event) {
        event.preventDefault();
        const form = this.element.find("form")[0];
        const formData = new FormDataExtended(form).object;

        // --- SCENES ---
        let selectedSceneIds = formData.sceneIds;
        if (!Array.isArray(selectedSceneIds) && selectedSceneIds) selectedSceneIds = [selectedSceneIds];
        selectedSceneIds = selectedSceneIds || [];

        // --- AUDIO ---
        let selectedAudioIds = formData.audioIds;
        if (!Array.isArray(selectedAudioIds) && selectedAudioIds) selectedAudioIds = [selectedAudioIds];
        selectedAudioIds = selectedAudioIds || [];

        if (selectedSceneIds.length === 0 && selectedAudioIds.length === 0) {
            return ui.notifications.warn("No items selected.");
        }

        const quality = parseFloat(formData.quality) || 0.85;
        const audioBitrate = parseInt(formData.audioBitrateAudio) || 128000;

        // Collect Objects
        const targetScenes = selectedSceneIds.map(id => game.scenes.get(id)).filter(s => s);
        // Map audio keys back to data objects
        const targetAudio = selectedAudioIds.map(key => this.audioData.find(a => a.uniqueId === key)).filter(a => a);

        this.isOptimizing = true;
        this.orphanedFiles = [];
        const totalItems = targetScenes.length + targetAudio.length;
        this.progress = { value: 0, max: totalItems, label: "Starting..." };
        this.render();

        // Small wait
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
            const labelText = `Converting Audio (OGG): ${item.name} (${completed + 1}/${total})`;
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
        this.element.find("progress").val(value);
        if (label) this.element.find(".progress-container label").text(label);
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

    async _updateObject(event, formData) { }
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
    const button = $(`<button class="scene-optimizer-btn"><i class="fas fa-magic"></i> Optimize Scenes</button>`);
    button.click(() => {
        new SceneOptimizer().render(true);
    });
    html.find(".header-actions").append(button);
});
