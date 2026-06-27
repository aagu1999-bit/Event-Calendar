import ReviewQueue from "./ReviewQueue.jsx";

// ReviewBeta — thin wrapper that mounts ReviewQueue with betaMode=true.
// Lets the user stress-test the Sweep-first conflict triage flow on any
// device (the standard Review tab keeps Sweep as mobile-only). Shares
// the same state stores as Review, so events / pending / approvals /
// sessions all carry across the two tabs without duplication.

export default function ReviewBeta() {
  return <ReviewQueue betaMode={true} />;
}
