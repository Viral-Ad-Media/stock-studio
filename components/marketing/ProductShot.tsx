import Image, { type StaticImageData } from "next/image";

// A real screenshot of the app in a browser-window frame. The screenshots use
// a fictional company and sample numbers, and the frame says so, so no image
// on the public site can be mistaken for a real study or live market data.
export default function ProductShot({
  src,
  alt,
  path,
  sizes = "(min-width: 1024px) 560px, 100vw",
  eager = false,
  className = "",
}: {
  src: StaticImageData;
  alt: string;
  path: string;
  sizes?: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure className={`overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-2xl shadow-black/50 ${className}`}>
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-800/80 px-3 py-2" aria-hidden>
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        </span>
        <span className="ml-2 truncate rounded bg-ink-900 px-2 py-0.5 font-mono text-[11px] text-fg-subtle">stockstudio{path}</span>
        <span className="ml-auto shrink-0 rounded border border-ink-500 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
          Sample data
        </span>
      </div>
      <Image
        src={src}
        alt={alt}
        sizes={sizes}
        placeholder="blur"
        className="h-auto w-full"
        {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
      />
    </figure>
  );
}
