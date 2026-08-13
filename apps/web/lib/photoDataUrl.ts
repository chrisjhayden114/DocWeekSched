export function fileToDataUrl(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number },
) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      if (!options || !file.type.startsWith("image/")) {
        resolve(raw);
        return;
      }

      const image = new Image();
      image.onload = () => {
        const maxWidth = options.maxWidth ?? image.width;
        const maxHeight = options.maxHeight ?? image.height;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(raw);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const output = canvas.toDataURL("image/jpeg", options.quality ?? 0.85);
        resolve(output);
      };
      image.onerror = () => resolve(raw);
      image.src = raw;
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
