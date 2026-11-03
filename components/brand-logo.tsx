import Image from "next/image";

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/kosher-smart-home.png"
      alt="Kosher Smart Home, בית חכם מהפלאפון הכשר"
      width={1547}
      height={451}
      priority
      className={className}
    />
  );
}
