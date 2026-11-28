let epoch = 0;

/** Drops the phone menu's saved device list. The next call reads the database again. */
export function invalidateIvrTargets() {
  epoch += 1;
}

export function ivrTargetEpoch() {
  return epoch;
}
