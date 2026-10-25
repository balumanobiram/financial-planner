import type { CardNetwork } from "../../api/cards";

/**
 * Simple monochrome network marks drawn in the card's text colour (`currentColor`) —
 * recognisable at a glance without reproducing each brand's official artwork.
 */
export function NetworkMark({ network, className }: { network: CardNetwork; className?: string }) {
  switch (network) {
    case "visa":
      return (
        <span className={className} aria-label="Visa" role="img">
          <span className="text-[22px] leading-none font-extrabold tracking-tight italic">VISA</span>
        </span>
      );
    case "mastercard":
      return (
        <svg viewBox="0 0 48 30" className={className} role="img" aria-label="Mastercard" width="44" height="28">
          <circle cx="17" cy="15" r="13" fill="currentColor" opacity="0.85" />
          <circle cx="31" cy="15" r="13" fill="currentColor" opacity="0.45" />
        </svg>
      );
    case "rupay":
      return (
        <span className={className} aria-label="RuPay" role="img">
          <span className="text-lg leading-none font-extrabold italic">
            Ru<span className="opacity-75">Pay</span>
          </span>
        </span>
      );
    case "amex":
      return (
        <span className={className} aria-label="American Express" role="img">
          <span className="rounded-[3px] border-2 border-current px-1 py-px text-[11px] leading-none font-black tracking-wider">
            AMEX
          </span>
        </span>
      );
    case "diners":
      return (
        <span className={className} aria-label="Diners Club" role="img">
          <span className="text-xs leading-tight font-bold">Diners Club</span>
        </span>
      );
    default:
      return null;
  }
}
