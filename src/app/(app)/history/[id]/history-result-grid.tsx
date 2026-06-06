"use client";

import { useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

interface Props {
  urls: string[];
}

export function HistoryResultGrid({ urls }: Props) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {urls.map((url, index) => {
          const alt = `生成结果 ${index + 1}`;
          return (
            <Card key={`${url}-${index}`} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setPreview({ src: url, alt })}
                className="relative block aspect-square w-full bg-muted outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                title="查看大图"
              >
                <Image
                  src={url}
                  alt={alt}
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </button>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">{preview?.alt ?? "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">预览当前生成结果图片。</DialogDescription>
          {preview && (
            <div className="flex max-h-[calc(100vh-5rem)] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.src}
                alt={preview.alt}
                className="max-h-[calc(100vh-5rem)] max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
