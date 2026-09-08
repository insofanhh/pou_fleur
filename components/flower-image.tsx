import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  sizes?: string;
  eager?: boolean;
  width?: number;
  height?: number;
};
export default function FlowerImage({
  src,
  alt,
  sizes = "(max-width: 700px) 45vw, 22vw",
  eager = false,
  width = 600,
  height = 750,
}: Props) {
  // Preserve arbitrary HTTPS images supported by the admin, without opening
  // the server image optimizer to arbitrary remote hosts.
  const optimize =
    /^\/images\/[a-zA-Z0-9._-]+$/.test(src) ||
    /^https:\/\/[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(src);
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      unoptimized={!optimize}
    />
  );
}
