import { constants, promises as fs } from 'node:fs'
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const writes = new Map<string, Promise<void>>()

export function writeJsonSync(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, filePath)
  } finally { try { rmSync(temporary, { force: true }) } catch { /* Preserve the original error. */ } }
}

// Rename a completed sibling file over the destination. Never remove the old
// destination first: a locked target must remain intact if replacement fails.
export async function replaceFile(tempPath: string, destination: string): Promise<void> {
  await fs.rename(tempPath, destination)
}

export function writeJson(filePath: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2)
  const key = path.resolve(filePath).toLowerCase()
  const operation = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(text, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await replaceFile(temporary, filePath)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  })
  writes.set(key, operation)
  void operation.finally(() => {
    if (writes.get(key) === operation) writes.delete(key)
  }).catch(() => undefined)
  return operation
}

export async function copyFileSafely(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await fs.copyFile(source, temporary)
    await replaceFile(temporary, destination)
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}

export async function copyUniqueFile(source: string, directory: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  for (let index = 0; ; index++) {
    const destination = path.join(directory, index ? `${stem} (${index})${extension}` : fileName)
    try {
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL)
      return destination
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}
