import {
  mkdir,
  lstat,
  writeFile,
  readFile,
  chmod,
  link,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Mail } from "./worker";
export function previewTransport(directory: string) {
  return async (mail: Mail) => {
    if (!/^[a-f0-9-]{36}$/.test(mail.id))
      throw new Error("Invalid preview identifier");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error("Unsafe preview directory");
    await chmod(directory, 0o700);
    const filename = join(directory, `${mail.id}.html`);
    const temporary = join(directory, `.${mail.id}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, mail.html, {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      // Publish only a complete file; a crash during writing leaves no partial final preview.
      await link(temporary, filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(filename);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (await readFile(filename, "utf8")) !== mail.html
      )
        throw new Error("Preview conflict");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };
}
