/** Checks a custom thumbnail against YouTube's rules (spec §0.5). Returns errors (blocking). */
export async function validateThumbnail(file: File): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    errors.push('Thumbnail must be a JPG or PNG.');
  }
  if (file.size > 2 * 1024 * 1024) {
    errors.push(`Thumbnail is ${(file.size / 1024 / 1024).toFixed(1)} MB (max 2 MB).`);
  }
  if (!errors.length) {
    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width < 640) warnings.push(`Thumbnail is ${bmp.width}px wide; at least 640px is recommended (1280×720 ideal).`);
      if (Math.abs(bmp.width / bmp.height - 16 / 9) > 0.02) {
        warnings.push(`Thumbnail is ${bmp.width}×${bmp.height}; YouTube expects 16:9 (1280×720).`);
      }
      bmp.close();
    } catch {
      errors.push("Couldn't read the thumbnail image.");
    }
  }
  return { errors, warnings };
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Name without extension, lowercase: pairs "clip01.mp4" with "clip01.md" and "clip01.jpg". */
export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}
