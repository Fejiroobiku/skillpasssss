/**
 * Job matching: rank verified apprentices for a job by skill match and distance.
 * Port of src/utils/matching.ts, so the numbers match the UI.
 *
 * Only skills backed by a VALID credential count, so an employer is never matched with someone
 * whose skills are claimed but unverified.
 */

/** Great-circle distance in km between two {lat, lng} points (haversine formula). */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** A weight is a share of the score, so it must be a real number from 0 to 1. */
function checkWeight(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  if (value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1 (got ${value}).`);
}

export class JobMatcher {
  /**
   * The score is always a whole number from 0 to 100. That only holds if each weight is between 0 and 1
   * and the two add up to 1, so the constructor checks each weight on its own as well as their sum:
   * weights of -0.2 and 1.2 add up to 1 but would let a score reach 110.
   *
   * @param {object} [options]
   * @param {number} [options.skillWeight]   share of the score from required skills held (default 70%)
   * @param {number} [options.distanceWeight] share from closeness (default 30%)
   * @param {number} [options.maxKm]         distance at which the closeness score reaches 0 (Lagos-sized: 30 km)
   */
  constructor({ skillWeight = 0.7, distanceWeight = 0.3, maxKm = 30 } = {}) {
    checkWeight('skillWeight', skillWeight);
    checkWeight('distanceWeight', distanceWeight);
    if (Math.abs(skillWeight + distanceWeight - 1) > 1e-9) throw new RangeError('Match weights must add up to 1.');
    if (typeof maxKm !== 'number' || !Number.isFinite(maxKm)) throw new TypeError('maxKm must be a finite number.');
    if (maxKm <= 0) throw new RangeError('maxKm must be positive.');
    Object.assign(this, { skillWeight, distanceWeight, maxKm });
    Object.freeze(this); // the checks above only mean something if the weights cannot be changed afterwards
  }

  /** Score one apprentice (0 to 100). @returns {{id: string, matched: number, score: number, km: number}} */
  score(job, apprentice) {
    const matched = job.skillIds.filter((s) => apprentice.verified.has(s)).length; // Set lookup: O(1) per skill
    const skillScore = job.skillIds.length ? matched / job.skillIds.length : 0;
    const km = distanceKm(job.location, apprentice.location);
    const distScore = Math.max(0, 1 - km / this.maxKm);
    return { id: apprentice.id, matched, km, score: Math.round((this.skillWeight * skillScore + this.distanceWeight * distScore) * 100) };
  }

  /**
   * Rank apprentices holding at least one required skill, best first. Equal scores are broken by more required
   * skills held, then by the shorter distance, so the order never depends on how the list arrived.
   * O(n·k + n log n) for n apprentices, k skills.
   * @param {{skillIds: string[], location: {lat: number, lng: number}}} job
   * @param {{id: string, location: {lat: number, lng: number}, verified: Set<string>}[]} apprentices
   */
  rank(job, apprentices) {
    return apprentices
      .map((a) => this.score(job, a))
      .filter((m) => m.matched > 0)
      .sort((x, y) => y.score - x.score || y.matched - x.matched || x.km - y.km)
      .map(({ id, matched, score }) => ({ id, matched, score }));
  }
}

const matcher = new JobMatcher();

/** apprentices: [{ id, location: {lat, lng}, verified: Set<skillId> }] */
export const rankMatches = (job, apprentices) => matcher.rank(job, apprentices);
