class FastConverter {
    static MAX_FILE_SIZE = 50 * 1024 * 1024;

    static FORMATS = {
        png: {
            extension: "png",
            mime: "image/png",
            type: "image",
            label: "PNG"
        },
        jpg: {
            extension: "jpg",
            mime: "image/jpeg",
            type: "image",
            label: "JPG"
        },
        pdf: {
            extension: "pdf",
            mime: "application/pdf",
            type: "pdf",
            label: "PDF"
        },
        docx: {
            extension: "docx",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            type: "document",
            label: "Word"
        },
        xlsx: {
            extension: "xlsx",
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type: "spreadsheet",
            label: "Excel"
        },
        pptx: {
            extension: "pptx",
            mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            type: "presentation",
            label: "PowerPoint"
        }
    };

    static IMAGE_EXTENSIONS = new Set([
        "png",
        "jpg",
        "jpeg",
        "webp",
        "gif",
        "bmp"
    ]);

    static TEXT_EXTENSIONS = new Set([
        "txt"
    ]);

    static SUPPORTED_EXTENSIONS = new Set([
        ...this.IMAGE_EXTENSIONS,
        ...this.TEXT_EXTENSIONS,
        "pdf",
        "docx",
        "xlsx",
        "pptx"
    ]);

    static async convert(file, output) {
        this.validateFile(file);

        const input = this.getExtension(file.name);

        if (input === output) {
            throw new Error(
                "The selected output format is the same as the input format."
            );
        }

        if (this.isImage(file)) {
            if (output === "pdf") {
                return this.imageToPDF(file);
            }

            if (output === "png") {
                return this.imageToImage(file, "image/png");
            }

            if (output === "jpg") {
                return this.imageToImage(file, "image/jpeg");
            }
        }

        if (this.isText(file)) {
            if (output === "pdf") {
                return this.textToPDF(file);
            }

            if (output === "docx") {
                return this.textToDOCX(file);
            }
        }

        throw new Error(
            `Conversion from .${input} to .${output} is not supported yet.`
        );
    }

    static async imageToPDF(file) {
        const image = await this.loadFileImage(file);

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const ctx = canvas.getContext("2d", {
            alpha: false
        });

        if (!ctx) {
            throw new Error("Unable to create canvas.");
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);

        const jpegURL = canvas.toDataURL(
            "image/jpeg",
            0.95
        );

        const jpegBytes = this.base64ToBytes(
            jpegURL.split(",")[1]
        );

        const pdf = this.createImagePDF(
            canvas.width,
            canvas.height,
            jpegBytes
        );

        this.download(
            new Blob([pdf], {
                type: "application/pdf"
            }),
            this.changeExtension(file.name, "pdf")
        );
    }

    static async imageToImage(file, type) {
        const image = await this.loadFileImage(file);

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const ctx = canvas.getContext("2d", {
            alpha: type === "image/png"
        });

        if (!ctx) {
            throw new Error("Unable to create canvas.");
        }

        if (type === "image/jpeg") {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.drawImage(image, 0, 0);

        const dataURL = canvas.toDataURL(
            type,
            0.95
        );

        const extension =
            type === "image/png"
                ? "png"
                : "jpg";

        this.download(
            this.dataURLToBlob(dataURL),
            this.changeExtension(
                file.name,
                extension
            )
        );
    }

    static async textToPDF(file) {
        const text = await file.text();

        const width = 595;
        const height = 842;
        const margin = 40;
        const lineHeight = 16;
        const maxCharacters = 90;

        const lines = this.wrapText(
            text,
            maxCharacters
        );

        const linesPerPage = Math.max(
            1,
            Math.floor(
                (height - margin * 2) / lineHeight
            )
        );

        const pages = [];

        for (
            let i = 0;
            i < lines.length;
            i += linesPerPage
        ) {
            pages.push(
                lines.slice(
                    i,
                    i + linesPerPage
                )
            );
        }

        if (!pages.length) {
            pages.push([""]);
        }

        const pdf = this.createTextPDF(
            width,
            height,
            pages,
            margin,
            lineHeight
        );

        this.download(
            new Blob([pdf], {
                type: "application/pdf"
            }),
            this.changeExtension(
                file.name,
                "pdf"
            )
        );
    }

    static async textToDOCX(file) {
        const text = await file.text();

        const paragraphs = text
            .split(/\r?\n/)
            .map(line => {
                if (!line.trim()) {
                    return "<w:p/>";
                }

                return (
                    "<w:p>" +
                    "<w:r>" +
                    `<w:t xml:space="preserve">${this.escapeXML(line)}</w:t>` +
                    "</w:r>" +
                    "</w:p>"
                );
            })
            .join("");

        const documentXML =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            "<w:body>" +
            paragraphs +
            "<w:sectPr>" +
            '<w:pgSz w:w="11906" w:h="16838"/>' +
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
            "</w:sectPr>" +
            "</w:body>" +
            "</w:document>";

        const contentTypes =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            "</Types>";

        const rels =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            "</Relationships>";

        const wordRels =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            "</Relationships>";

        const files = [
            {
                name: "[Content_Types].xml",
                data: this.stringToBytes(contentTypes)
            },
            {
                name: "_rels/.rels",
                data: this.stringToBytes(rels)
            },
            {
                name: "word/document.xml",
                data: this.stringToBytes(documentXML)
            },
            {
                name: "word/_rels/document.xml.rels",
                data: this.stringToBytes(wordRels)
            }
        ];

        const zip = this.createZIP(files);

        this.download(
            new Blob([zip], {
                type: this.FORMATS.docx.mime
            }),
            this.changeExtension(
                file.name,
                "docx"
            )
        );
    }

    static createImagePDF(width, height, jpegBytes) {
        const objects = [];

        objects[1] = this.stringToBytes(
            "<< /Type /Catalog /Pages 2 0 R >>"
        );

        objects[2] = this.stringToBytes(
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"
        );

        objects[3] = this.stringToBytes(
            `<< /Type /Page /Parent 2 0 R ` +
            `/MediaBox [0 0 ${width} ${height}] ` +
            `/Resources << /XObject << /Im1 5 0 R >> >> ` +
            `/Contents 4 0 R >>`
        );

        const content = [
            "q",
            `${width} 0 0 ${height} 0 0 cm`,
            "/Im1 Do",
            "Q"
        ].join("\n");

        const contentBytes =
            this.stringToBytes(content);

        objects[4] = this.concatBytes([
            this.stringToBytes(
                `<< /Length ${contentBytes.length} >>\nstream\n`
            ),
            contentBytes,
            this.stringToBytes("\nendstream")
        ]);

        objects[5] = this.concatBytes([
            this.stringToBytes(
                `<< /Type /XObject ` +
                `/Subtype /Image ` +
                `/Width ${width} ` +
                `/Height ${height} ` +
                `/ColorSpace /DeviceRGB ` +
                `/BitsPerComponent 8 ` +
                `/Filter /DCTDecode ` +
                `/Length ${jpegBytes.length} >>\nstream\n`
            ),
            jpegBytes,
            this.stringToBytes("\nendstream")
        ]);

        return this.buildPDF(objects);
    }

    static createTextPDF(
        width,
        height,
        pages,
        margin,
        lineHeight
    ) {
        const objects = [];

        objects[1] = this.stringToBytes(
            "<< /Type /Catalog /Pages 2 0 R >>"
        );

        const pageIDs = [];
        const fontID = 3 + pages.length * 2;

        objects[fontID] = this.stringToBytes(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
        );

        pages.forEach((page, index) => {
            const pageID = 3 + index * 2;
            const contentID = pageID + 1;

            pageIDs.push(pageID);

            const commands = [
                "BT",
                "/F1 11 Tf",
                `${margin} ${height - margin} Td`
            ];

            page.forEach(line => {
                commands.push(
                    `(${this.escapePDFText(line)}) Tj`,
                    `0 -${lineHeight} Td`
                );
            });

            commands.push("ET");

            const contentBytes =
                this.stringToBytes(
                    commands.join("\n")
                );

            objects[contentID] = this.concatBytes([
                this.stringToBytes(
                    `<< /Length ${contentBytes.length} >>\nstream\n`
                ),
                contentBytes,
                this.stringToBytes("\nendstream")
            ]);

            objects[pageID] = this.stringToBytes(
                `<< /Type /Page ` +
                `/Parent 2 0 R ` +
                `/MediaBox [0 0 ${width} ${height}] ` +
                `/Resources << /Font << /F1 ${fontID} 0 R >> >> ` +
                `/Contents ${contentID} 0 R >>`
            );
        });

        objects[2] = this.stringToBytes(
            `<< /Type /Pages ` +
            `/Kids [${pageIDs.join(" ")}] ` +
            `/Count ${pageIDs.length} >>`
        );

        return this.buildPDF(objects);
    }

    static buildPDF(objects) {
        const parts = [];
        const offsets = new Array(objects.length).fill(0);
        let position = 0;

        const add = bytes => {
            parts.push(bytes);
            position += bytes.length;
        };

        add(
            this.stringToBytes(
                "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"
            )
        );

        for (let i = 1; i < objects.length; i++) {
            if (!objects[i]) {
                continue;
            }

            offsets[i] = position;

            add(
                this.stringToBytes(
                    `${i} 0 obj\n`
                )
            );

            add(objects[i]);
            add(this.stringToBytes("\nendobj\n"));
        }

        const xrefPosition = position;

        let xref =
            `xref\n0 ${objects.length}\n`;

        xref += "0000000000 65535 f \n";

        for (let i = 1; i < objects.length; i++) {
            xref +=
                String(offsets[i]).padStart(10, "0") +
                " 00000 n \n";
        }

        add(this.stringToBytes(xref));

        add(
            this.stringToBytes(
                `trailer\n` +
                `<< /Size ${objects.length} /Root 1 0 R >>\n` +
                `startxref\n` +
                `${xrefPosition}\n` +
                `%%EOF`
            )
        );

        return this.concatBytes(parts);
    }

    static createZIP(files) {
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        for (const file of files) {
            const name = this.stringToBytes(file.name);
            const data = file.data;
            const crc = this.crc32(data);

            const localHeader = new Uint8Array(30);

            this.write32(localHeader, 0, 0x04034b50);
            this.write16(localHeader, 4, 20);
            this.write16(localHeader, 6, 0);
            this.write16(localHeader, 8, 0);
            this.write16(localHeader, 10, 0);
            this.write16(localHeader, 12, 0);
            this.write32(localHeader, 14, crc);
            this.write32(localHeader, 18, data.length);
            this.write32(localHeader, 22, data.length);
            this.write16(localHeader, 26, name.length);
            this.write16(localHeader, 28, 0);

            localParts.push(
                localHeader,
                name,
                data
            );

            const centralHeader = new Uint8Array(46);

            this.write32(centralHeader, 0, 0x02014b50);
            this.write16(centralHeader, 4, 20);
            this.write16(centralHeader, 6, 20);
            this.write16(centralHeader, 8, 0);
            this.write16(centralHeader, 10, 0);
            this.write16(centralHeader, 12, 0);
            this.write16(centralHeader, 14, 0);
            this.write32(centralHeader, 16, crc);
            this.write32(centralHeader, 20, data.length);
            this.write32(centralHeader, 24, data.length);
            this.write16(centralHeader, 28, name.length);
            this.write16(centralHeader, 30, 0);
            this.write16(centralHeader, 32, 0);
            this.write16(centralHeader, 34, 0);
            this.write16(centralHeader, 36, 0);
            this.write32(centralHeader, 38, 0);
            this.write32(centralHeader, 42, offset);

            centralParts.push(
                centralHeader,
                name
            );

            offset +=
                30 +
                name.length +
                data.length;
        }

        const centralSize =
            centralParts.reduce(
                (sum, part) => sum + part.length,
                0
            );

        const localSize =
            localParts.reduce(
                (sum, part) => sum + part.length,
                0
            );

        const end = new Uint8Array(22);

        this.write32(end, 0, 0x06054b50);
        this.write16(end, 4, 0);
        this.write16(end, 6, 0);
        this.write16(end, 8, files.length);
        this.write16(end, 10, files.length);
        this.write32(end, 12, centralSize);
        this.write32(end, 16, localSize);
        this.write16(end, 20, 0);

        return this.concatBytes([
            ...localParts,
            ...centralParts,
            end
        ]);
    }

    static crc32(data) {
        let crc = 0xffffffff;

        for (const byte of data) {
            crc ^= byte;

            for (let i = 0; i < 8; i++) {
                crc =
                    (crc >>> 1) ^
                    ((crc & 1) ? 0xedb88320 : 0);
            }
        }

        return (crc ^ 0xffffffff) >>> 0;
    }

    static wrapText(text, max) {
        const result = [];

        for (const paragraph of text.split(/\r?\n/)) {
            if (!paragraph) {
                result.push("");
                continue;
            }

            const words = paragraph.split(/\s+/);
            let line = "";

            for (const word of words) {
                const test = line
                    ? `${line} ${word}`
                    : word;

                if (test.length > max && line) {
                    result.push(line);
                    line = word;
                } else {
                    line = test;
                }
            }

            if (line) {
                result.push(line);
            }
        }

        return result;
    }

    static escapePDFText(text) {
        return text
            .replace(/\\/g, "\\\\")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)")
            .replace(/[^\x20-\x7E]/g, "?");
    }

    static escapeXML(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    static async loadFileImage(file) {
        const url = URL.createObjectURL(file);

        try {
            return await this.loadImage(url);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    static loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => resolve(image);

            image.onerror = () => reject(
                new Error("Unable to decode the image.")
            );

            image.src = src;
        });
    }

    static base64ToBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes;
    }

    static dataURLToBlob(dataURL) {
        const [header, base64] =
            dataURL.split(",");

        const match =
            header.match(/:(.*?);/);

        const mime =
            match?.[1] ||
            "application/octet-stream";

        return new Blob(
            [this.base64ToBytes(base64)],
            {
                type: mime
            }
        );
    }

    static stringToBytes(value) {
        return new TextEncoder().encode(value);
    }

    static concatBytes(parts) {
        const total = parts.reduce(
            (sum, part) => sum + part.length,
            0
        );

        const result = new Uint8Array(total);
        let offset = 0;

        for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
        }

        return result;
    }

    static download(blob, name) {
        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement("a");

        link.href = url;
        link.download = name;
        link.style.display = "none";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(
            () => URL.revokeObjectURL(url),
            1000
        );
    }

    static getExtension(name) {
        return (
            name
                .split(".")
                .pop()
                .toLowerCase()
        );
    }

    static changeExtension(name, extension) {
        return (
            name.replace(
                /\.[^/.]+$/,
                ""
            ) +
            "." +
            extension
        );
    }

    static getFormatLabel(extension) {
        const labels = {
            png: "PNG",
            jpg: "JPG",
            jpeg: "JPG",
            webp: "WebP",
            gif: "GIF",
            bmp: "BMP",
            txt: "TXT",
            pdf: "PDF",
            docx: "Word",
            xlsx: "Excel",
            pptx: "PowerPoint"
        };

        return labels[extension] || extension.toUpperCase();
    }

    static isImage(file) {
        return this.IMAGE_EXTENSIONS.has(
            this.getExtension(file.name)
        );
    }

    static isText(file) {
        return this.TEXT_EXTENSIONS.has(
            this.getExtension(file.name)
        );
    }

    static validateFile(file) {
        if (!(file instanceof File)) {
            throw new Error("Invalid file.");
        }

        if (!file.size) {
            throw new Error("The file is empty.");
        }

        if (file.size > this.MAX_FILE_SIZE) {
            throw new Error(
                "The maximum file size is 50 MB."
            );
        }

        const extension =
            this.getExtension(file.name);

        if (
            !this.SUPPORTED_EXTENSIONS.has(
                extension
            )
        ) {
            throw new Error(
                "This file type is not supported."
            );
        }
    }

    static write16(array, offset, value) {
        array[offset] = value & 255;
        array[offset + 1] =
            (value >>> 8) & 255;
    }

    static write32(array, offset, value) {
        array[offset] = value & 255;
        array[offset + 1] =
            (value >>> 8) & 255;
        array[offset + 2] =
            (value >>> 16) & 255;
        array[offset + 3] =
            (value >>> 24) & 255;
    }
}

const fileInput =
    document.getElementById("file-input");

const dropZone =
    document.getElementById("drop-zone");

const fileButton =
    document.getElementById("file-button");

const fileChangeButton =
    document.getElementById("file-change-button");

const preview =
    document.getElementById("file-preview");

const previewImage =
    document.getElementById("preview-image");

const previewIcon =
    document.getElementById("preview-icon");

const fileName =
    document.getElementById("file-name");

const fileDetails =
    document.getElementById("file-details");

const controls =
    document.getElementById("converter-controls");

const outputFormat =
    document.getElementById("output-format");

const convertButton =
    document.getElementById("convert-button");

const status =
    document.getElementById("converter-status");

let selectedFile = null;
let previewURL = null;

const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
};

const formatSize = bytes => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(
        bytes /
        1024 /
        1024
    ).toFixed(2)} MB`;
};

const clearPreviewURL = () => {
    if (previewURL) {
        URL.revokeObjectURL(previewURL);
        previewURL = null;
    }
};

const resetUI = () => {
    clearPreviewURL();

    selectedFile = null;
    fileInput.value = "";

    preview.hidden = true;
    controls.hidden = true;
    dropZone.hidden = false;

    previewImage.hidden = true;
    previewImage.removeAttribute("src");

    previewIcon.hidden = true;

    outputFormat.innerHTML = "";
    outputFormat.disabled = true;

    convertButton.disabled = true;

    fileName.textContent = "";
    fileDetails.textContent = "";

    setStatus("Select a file to begin.");
};

const getOutputFormats = file => {
    const extension =
        FastConverter.getExtension(
            file.name
        );

    if (FastConverter.isImage(file)) {
        return ["png", "jpg", "pdf"]
            .filter(format =>
                format !== extension &&
                !(format === "jpg" && extension === "jpeg")
            );
    }

    if (FastConverter.isText(file)) {
        return ["pdf", "docx"];
    }

    if (extension === "pdf") {
        return ["docx"];
    }

    if (extension === "docx") {
        return ["pdf"];
    }

    if (extension === "xlsx") {
        return [];
    }

    if (extension === "pptx") {
        return [];
    }

    return [];
};

const updateOutputFormats = file => {
    const formats =
        getOutputFormats(file);

    outputFormat.innerHTML = "";

    for (const format of formats) {
        const option =
            document.createElement("option");

        option.value = format;
        option.textContent =
            FastConverter.getFormatLabel(format);

        outputFormat.appendChild(option);
    }

    outputFormat.disabled =
        formats.length === 0;

    convertButton.disabled =
        formats.length === 0;
};

const showPreview = file => {
    clearPreviewURL();

    const extension =
        FastConverter.getExtension(
            file.name
        );

    preview.hidden = false;
    dropZone.hidden = true;

    fileName.textContent = file.name;

    fileDetails.textContent =
        `${FastConverter.getFormatLabel(extension)} · ${formatSize(file.size)}`;

    previewImage.hidden = true;
    previewIcon.hidden = true;

    if (FastConverter.isImage(file)) {
        previewURL =
            URL.createObjectURL(file);

        previewImage.src = previewURL;
        previewImage.hidden = false;
    } else {
        previewIcon.textContent =
            FastConverter.getFormatLabel(
                extension
            );

        previewIcon.hidden = false;
    }
};

const selectFile = file => {
    if (!file) {
        return;
    }

    try {
        FastConverter.validateFile(file);
    } catch (error) {
        resetUI();

        setStatus(
            error instanceof Error
                ? error.message
                : "Invalid file.",
            true
        );

        return;
    }

    selectedFile = file;

    showPreview(file);
    updateOutputFormats(file);

    controls.hidden = false;

    if (!outputFormat.options.length) {
        setStatus(
            "No conversion is available for this file type.",
            true
        );

        return;
    }

    setStatus("File ready.");
};

dropZone.addEventListener(
    "click",
    () => fileInput.click()
);

dropZone.addEventListener(
    "keydown",
    event => {
        if (
            event.key === "Enter" ||
            event.key === " "
        ) {
            event.preventDefault();
            fileInput.click();
        }
    }
);

dropZone.addEventListener(
    "dragenter",
    event => {
        event.preventDefault();
        dropZone.classList.add("drag-active");
    }
);

dropZone.addEventListener(
    "dragover",
    event => {
        event.preventDefault();
        dropZone.classList.add("drag-active");
    }
);

dropZone.addEventListener(
    "dragleave",
    event => {
        if (!dropZone.contains(event.relatedTarget)) {
            dropZone.classList.remove("drag-active");
        }
    }
);

dropZone.addEventListener(
    "drop",
    event => {
        event.preventDefault();

        dropZone.classList.remove("drag-active");

        const file =
            event.dataTransfer.files?.[0];

        selectFile(file);
    }
);

fileInput.addEventListener(
    "change",
    () => {
        selectFile(
            fileInput.files?.[0] || null
        );
    }
);

fileChangeButton.addEventListener(
    "click",
    () => fileInput.click()
);

convertButton.addEventListener(
    "click",
    async () => {
        if (!selectedFile) {
            return;
        }

        const output =
            outputFormat.value;

        const originalText =
            convertButton.querySelector("span").textContent;

        try {
            convertButton.disabled = true;
            outputFormat.disabled = true;

            convertButton.querySelector("span").textContent =
                "CONVERTING...";

            setStatus(
                "Processing file..."
            );

            await FastConverter.convert(
                selectedFile,
                output
            );

            setStatus(
                "Conversion completed successfully."
            );
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Conversion failed.",
                true
            );
        } finally {
            convertButton.querySelector("span").textContent =
                originalText;

            outputFormat.disabled = false;

            convertButton.disabled =
                !outputFormat.options.length;
        }
    }
);

window.addEventListener(
    "beforeunload",
    clearPreviewURL
);
