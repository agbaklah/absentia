/** SPERO brand mark — the official FLEET logo, rendered as an <img>. */
export function SperoLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/favicon.png"
      alt="SPERO"
      width={size}
      height={size}
      className={className}
      style={{ display: "inline-block", lineHeight: 0 }}
    />
  );
}
