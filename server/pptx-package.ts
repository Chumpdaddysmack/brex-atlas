import JSZip from "jszip";

/** Remove PptxGenJS 3.x phantom master declarations and ZIP directory records.
 * This is part of every export, not a one-off repair of a sample download.
 */
export async function compatiblePptx(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const contentTypes = zip.file("[Content_Types].xml");
  if (!contentTypes) throw new Error("PowerPoint package is missing content types");
  const xml = await contentTypes.async("string");
  zip.file("[Content_Types].xml", xml.replace(
    /<Override\s+PartName="\/ppt\/slideMasters\/slideMaster(\d+)\.xml"[^>]*\/>/g,
    (match, id) => zip.file(`ppt/slideMasters/slideMaster${id}.xml`) ? match : "",
  ));
  // Build a clean archive rather than remove(), which recursively deletes the
  // children of directory entries in JSZip.
  const clean = new JSZip();
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name];
    if (!file.dir) clean.file(name, await file.async("nodebuffer"), { createFolders: false });
  }
  return clean.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
