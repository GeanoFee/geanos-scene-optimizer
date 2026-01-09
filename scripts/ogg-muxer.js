/**
 * Minimal Ogg Opus Muxer for client-side generation.
 * Wraps Opus packets into Ogg Pages with CRC32 checksums.
 */
export class OggOpusMuxer {
    constructor(sampleRate, numberOfChannels) {
        this.sampleRate = sampleRate;
        this.channels = numberOfChannels;
        this.serial = Math.floor(Math.random() * 0xFFFFFFFF);
        this.pageSequence = 0;
        this.granulePosition = 0;
        this.pages = [];
        this.crcTable = this._makeCRCTable();

        // Buffers
        this.packetBuffer = [];
        this.packetSizes = [];
        this.segmentsInBuffer = 0;

        // Write Headers immediately
        this._writeIdHeader();
        this._writeCommentHeader();
    }

    /**
     * Adds an Opus packet (EncodedAudioChunk) to the stream.
     * @param {Uint8Array} packetData 
     * @param {number} samples Number of samples in this packet (usually 960 for 20ms at 48k)
     */
    addPacket(packetData, samples) {
        // Ogg segmentation logic: packets are split into 255-byte segments
        const size = packetData.byteLength;
        const numSegments = Math.floor(size / 255) + 1;

        // If adding this packet would exceed page limits (255 segments), flush first
        if (this.segmentsInBuffer + numSegments > 255) {
            this.flushPage();
        }

        this.packetBuffer.push(packetData);
        this.packetSizes.push(size);
        this.segmentsInBuffer += numSegments;
        this.granulePosition += samples;
    }

    /**
     * Forces the current buffer into an Ogg Page.
     * @param {boolean} isLast Is this the End of Stream?
     */
    flushPage(isLast = false) {
        if (this.packetBuffer.length === 0 && !isLast) return;

        // 1. Calculate Page Size
        // Header (27) + Segments Table (N) + Data (Sum of sizes)
        const numSegments = this.segmentsInBuffer;
        const dataSize = this.packetSizes.reduce((a, b) => a + b, 0);
        const pageSize = 27 + numSegments + dataSize;

        const buffer = new Uint8Array(pageSize);
        const view = new DataView(buffer.buffer);

        // 2. Write Header
        const capturePattern = [0x4f, 0x67, 0x67, 0x53]; // OggS
        capturePattern.forEach((b, i) => view.setUint8(i, b));

        view.setUint8(4, 0); // Version

        let headerType = 0;
        if (this.pageSequence === 0) headerType |= 0x02; // BOF
        if (isLast) headerType |= 0x04; // EOF
        view.setUint8(5, headerType);

        view.setBigUint64(6, BigInt(this.granulePosition), true); // Granule Pos
        view.setUint32(14, this.serial, true); // Serial
        view.setUint32(18, this.pageSequence++, true); // Seq Number
        view.setUint32(22, 0, true); // CRC Checksum (placeholder)
        view.setUint8(26, numSegments); // Page segments

        // 3. Write Segment Table
        let offset = 27;
        for (let size of this.packetSizes) {
            while (size >= 255) {
                view.setUint8(offset++, 255);
                size -= 255;
            }
            view.setUint8(offset++, size);
        }

        // 4. Write Data
        for (let packet of this.packetBuffer) {
            buffer.set(packet, offset);
            offset += packet.byteLength;
        }

        // 5. Calculate CRC
        const crc = this._calculateCRC(buffer);
        view.setUint32(22, crc, true);

        this.pages.push(buffer);

        // Reset Buffer
        this.packetBuffer = [];
        this.packetSizes = [];
        this.segmentsInBuffer = 0;
    }

    getBlob() {
        // Ensure last page is written
        this.flushPage(true);
        return new Blob(this.pages, { type: 'audio/ogg' });
    }

    _writeIdHeader() {
        // Opus Head: Magic 'OpusHead' + Ver + Channels + PreSkip + Rate + Gain + Map
        // Fixed 19 bytes for simple mapping
        const header = new Uint8Array(19);
        const view = new DataView(header.buffer);

        const magic = "OpusHead";
        for (let i = 0; i < 8; i++) view.setUint8(i, magic.charCodeAt(i));

        view.setUint8(8, 1); // Ver 1
        view.setUint8(9, this.channels);
        view.setUint16(10, 0, true); // Pre-skip (0 usually OK for raw)
        view.setUint32(12, this.sampleRate, true);
        view.setUint16(16, 0, true); // Output Gain
        view.setUint8(18, 0); // Channel Mapping Family 0 (mono/stereo)

        this.addPacket(header, 0);
        this.flushPage(); // BOS page must be id header only
    }

    _writeCommentHeader() {
        // OpusTags: Magic 'OpusTags' + Vendor Len + Vendor + List Len
        const vendor = "Geano Scene Optimizer";
        const len = 8 + 4 + vendor.length + 4;
        const buffer = new Uint8Array(len);
        const view = new DataView(buffer.buffer);

        const magic = "OpusTags";
        for (let i = 0; i < 8; i++) view.setUint8(i, magic.charCodeAt(i));

        view.setUint32(8, vendor.length, true);
        for (let i = 0; i < vendor.length; i++) view.setUint8(12 + i, vendor.charCodeAt(i));

        view.setUint32(12 + vendor.length, 0, true); // 0 user comments

        this.addPacket(buffer, 0);
        this.flushPage();
    }

    _makeCRCTable() {
        let c;
        const crcTable = [];
        for (let n = 0; n < 256; n++) {
            c = n << 24;
            for (let k = 0; k < 8; k++) {
                c = ((c & 0x80000000) ? (0x04c11db7 ^ (c << 1)) : (c << 1));
            }
            crcTable[n] = c >>> 0;
        }
        return crcTable;
    }

    _calculateCRC(buffer) {
        let crc = 0;
        for (let i = 0; i < buffer.length; i++) {
            // Skip checksum bytes themselves (22-25) during calc
            if (i >= 22 && i <= 25) {
                crc = (crc << 8) ^ this.crcTable[((crc >>> 24) ^ 0) & 0xFF];
                continue;
            }
            crc = (crc << 8) ^ this.crcTable[((crc >>> 24) ^ buffer[i]) & 0xFF];
        }
        return crc >>> 0;
    }
}
