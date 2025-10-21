import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { Buffer } from "buffer";

ffmpeg.setFfmpegPath(ffmpegPath as string);
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const data = await req.formData();
    const file = data.get("image") as File;
    if (!file)
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageStream = Readable.from(buffer);

    // Use a memory buffer instead of streaming directly
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(imageStream)
        .inputFormat("image2pipe")
        .loop(3.2)
        .videoCodec("libx264")
        .outputOptions([
          "-pix_fmt yuv420p",
          "-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        ])
        .format("mp4")
        .on("error", reject)
        // @ts-ignore
        .on("end", resolve)
        .pipe()
        .on("data", (chunk) => chunks.push(chunk))
        .on("error", reject);
    });

    const videoBuffer = Buffer.concat(chunks);

    return new NextResponse(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'inline; filename="output.mp4"',
      },
    });
  } catch (err) {
    console.error("Video generation failed:", err);
    return new NextResponse("Video generation failed", { status: 500 });
  }
}
