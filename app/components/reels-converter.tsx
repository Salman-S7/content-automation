"use client";

import React, { useState, useRef, ChangeEvent } from "react";
import { Upload, Download, Loader2, PlayCircle, X, Trash2 } from "lucide-react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

interface LogEvent {
  message: string;
}

interface ProgressEvent {
  progress: number;
  time: number;
}

interface VideoItem {
  id: string;
  fileName: string;
  preview: string;
  videoUrl: string | null;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
}

export default function ImageToVideoConverter() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [duration, setDuration] = useState<number>(3.2);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const validFiles = selectedFiles.filter((file) => {
      if (!file.type.startsWith("image/")) {
        alert(`${file.name} is not an image file`);
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });

    const newVideos: VideoItem[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      fileName: file.name,
      preview: URL.createObjectURL(file),
      videoUrl: null,
      status: "pending",
      progress: 0,
    }));

    setVideos((prev) => [...prev, ...newVideos]);

    // Store files temporarily
    validFiles.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = () => {
        const id = newVideos[index].id;
        sessionStorage.setItem(`file-${id}`, reader.result as string);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const loadFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpegRef.current) return ffmpegRef.current;

    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const convertSingleVideo = async (videoItem: VideoItem): Promise<void> => {
    try {
      // Update status to processing
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoItem.id
            ? { ...v, status: "processing", progress: 0 }
            : v
        )
      );

      const ffmpeg = await loadFFmpeg();

      // Set up progress tracking for this specific video
      const progressHandler = ({ progress: prog }: ProgressEvent) => {
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoItem.id ? { ...v, progress: Math.round(prog) } : v
          )
        );
      };

      ffmpeg.on("progress", progressHandler);

      // Get file from sessionStorage
      const fileData = sessionStorage.getItem(`file-${videoItem.id}`);
      if (!fileData) throw new Error("File data not found");

      // Convert base64 to blob
      const response = await fetch(fileData);
      const blob = await response.blob();

      // Write input file
      await ffmpeg.writeFile("input.png", await fetchFile(blob));

      // Run FFmpeg command for vertical video (9:16 aspect ratio - Reels/Shorts format)
      await ffmpeg.exec([
        "-loop",
        "1",
        "-i",
        "input.png",
        "-t",
        duration.toString(),
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1", // 9:16 vertical format
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
        "output.mp4",
      ]);

      // Read output
      const data = await ffmpeg.readFile("output.mp4");
      // @ts-ignore
      const videoBlob = new Blob([data], { type: "video/mp4" });
      const url = URL.createObjectURL(videoBlob);

      // Update video with result
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoItem.id
            ? { ...v, videoUrl: url, status: "completed", progress: 100 }
            : v
        )
      );

      // Clean up
      ffmpeg.off("progress", progressHandler);
    } catch (err) {
      console.error("Conversion error:", err);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoItem.id
            ? {
                ...v,
                status: "error",
                error: err instanceof Error ? err.message : "Conversion failed",
              }
            : v
        )
      );
    }
  };

  const convertAllVideos = async (): Promise<void> => {
    setIsConverting(true);

    const pendingVideos = videos.filter(
      (v) => v.status === "pending" || v.status === "error"
    );

    for (const video of pendingVideos) {
      await convertSingleVideo(video);
    }

    setIsConverting(false);
  };

  const downloadVideo = (videoItem: VideoItem): void => {
    if (!videoItem.videoUrl) return;

    const a = document.createElement("a");
    a.href = videoItem.videoUrl;
    a.download = `${videoItem.fileName.replace(/\.[^/.]+$/, "")}-video.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAll = (): void => {
    const completedVideos = videos.filter((v) => v.videoUrl);

    completedVideos.forEach((video, index) => {
      setTimeout(() => {
        downloadVideo(video);
      }, index * 500); // Stagger downloads by 500ms
    });
  };

  const removeVideo = (id: string): void => {
    setVideos((prev) => {
      const video = prev.find((v) => v.id === id);
      if (video) {
        URL.revokeObjectURL(video.preview);
        if (video.videoUrl) URL.revokeObjectURL(video.videoUrl);
        sessionStorage.removeItem(`file-${id}`);
      }
      return prev.filter((v) => v.id !== id);
    });
  };

  const clearAll = (): void => {
    videos.forEach((video) => {
      URL.revokeObjectURL(video.preview);
      if (video.videoUrl) URL.revokeObjectURL(video.videoUrl);
      sessionStorage.removeItem(`file-${video.id}`);
    });
    setVideos([]);
  };

  const pendingCount = videos.filter(
    (v) => v.status === "pending" || v.status === "error"
  ).length;
  const completedCount = videos.filter((v) => v.status === "completed").length;

  return (
    <div className="min-h-screen bg-linear-to-br from-purple-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
                Reels/Shorts Video Converter
              </h1>
              <p className="text-gray-600">
                Convert images to vertical videos (9:16) - Perfect for Instagram
                Reels & YouTube Shorts!
              </p>
            </div>
            {videos.length > 0 && (
              <button
                onClick={clearAll}
                className="text-red-600 hover:text-red-700 font-medium flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
          </div>

          {/* Upload Section */}
          <div className="mb-6">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center"
              >
                <Upload className="w-12 h-12 text-gray-400 mb-3" />
                <span className="text-lg font-medium text-gray-700 mb-1">
                  Click to upload images
                </span>
                <span className="text-sm text-gray-500">
                  PNG, JPG, WEBP • Max 10MB each • Multiple files supported
                </span>
              </label>
            </div>
          </div>

          {/* Settings */}
          {videos.length > 0 && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-64">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Video Duration: {duration}s
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.1"
                    value={duration}
                    onChange={(e) => setDuration(parseFloat(e.target.value))}
                    className="w-full"
                    disabled={isConverting}
                  />
                </div>
                <div className="flex gap-3">
                  {pendingCount > 0 && (
                    <button
                      onClick={convertAllVideos}
                      disabled={isConverting}
                      className="bg-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isConverting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Converting...
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-5 h-5" />
                          Convert All ({pendingCount})
                        </>
                      )}
                    </button>
                  )}
                  {completedCount > 0 && (
                    <button
                      onClick={downloadAll}
                      className="bg-green-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download All ({completedCount})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Video Grid */}
          {videos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200"
                >
                  {/* Preview/Video Display */}
                  <div className="relative bg-black aspect-9/16">
                    {video.status === "completed" && video.videoUrl ? (
                      <video
                        src={video.videoUrl}
                        controls
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <img
                        src={video.preview}
                        alt={video.fileName}
                        className="w-full h-full object-contain"
                      />
                    )}

                    {/* Status Overlay */}
                    {video.status === "processing" && (
                      <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center">
                        <Loader2 className="w-12 h-12 text-white animate-spin mb-2" />
                        <span className="text-white font-medium">
                          {video.progress}%
                        </span>
                      </div>
                    )}

                    {/* Remove Button */}
                    <button
                      onClick={() => removeVideo(video.id)}
                      className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 shadow-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    {/* Status Badge */}
                    <div className="absolute bottom-2 left-2">
                      {video.status === "pending" && (
                        <span className="bg-yellow-500 text-white text-xs px-2 py-1 rounded-full">
                          Pending
                        </span>
                      )}
                      {video.status === "completed" && (
                        <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                          Completed
                        </span>
                      )}
                      {video.status === "error" && (
                        <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                          Error
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Info & Actions */}
                  <div className="p-3">
                    <p className="text-sm font-medium text-gray-700 truncate mb-2">
                      {video.fileName}
                    </p>

                    {video.status === "processing" && (
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-purple-600 h-full transition-all duration-300"
                          style={{ width: `${video.progress}%` }}
                        />
                      </div>
                    )}

                    {video.status === "completed" && video.videoUrl && (
                      <button
                        onClick={() => downloadVideo(video)}
                        className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    )}

                    {video.status === "error" && (
                      <div className="text-xs text-red-600">
                        {video.error || "Failed to convert"}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">
              <Upload className="w-16 h-16 mx-auto mb-3 opacity-50" />
              <p>No images uploaded yet. Click above to get started!</p>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-8 bg-blue-50 rounded-xl p-6">
            <h3 className="font-semibold text-blue-900 mb-2">
              ✨ Perfect for Social Media
            </h3>
            <p className="text-sm text-blue-800 mb-2">
              Videos are created in 9:16 vertical format (1080x1920) - ideal for
              Instagram Reels, YouTube Shorts, and TikTok!
            </p>
            <p className="text-sm text-blue-800">
              All processing happens in your browser. No uploads, complete
              privacy!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
