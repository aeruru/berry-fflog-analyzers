// Resolve Dancing Mad's fight-specific death explanations in one chronological
// decision tree. Returning null deliberately hands the event back to the generic
// recent-damage/Unknown fallback in app.js.
export function findCauseOfDeath(death) {
  switch (death.phase) {
    case 1:
      if (death.time >= 18 && death.time < 21) {
        if (death.killingAbility !== 'Revolting Ruin III') return null;
        if (!death.isTank) return 'Nontank killed by 2nd RR1 hit.';

        const overkill = Number(death.overkill);
        const overkillText = Number.isFinite(overkill)
          ? Math.max(0, overkill).toLocaleString('en-US')
          : 'an unknown amount';
        let cause = `Tank overkilled by ${overkillText} from 2nd RR1 hit.`;
        if (!death.activeBuffs.has('Rampart') && !death.hasFortyPercentMitigation) {
          cause += ' Likely missing invuln.';
        }
        return cause;
      }

      if (death.time >= 15 && death.time < 18) {
        if (death.killingAbility !== 'Revolting Ruin III') return null;
        if (!death.isTank) return 'Nontank killed by 1st RR1 hit.';

        const overkill = Number(death.overkill);
        const overkillText = Number.isFinite(overkill)
          ? Math.max(0, overkill).toLocaleString('en-US')
          : 'an unknown amount';
        let cause = `Tank overkilled by ${overkillText} from 1st RR1 hit.`;
        if (!death.activeBuffs.has('Rampart') && !death.hasFortyPercentMitigation) {
          cause += ' Likely missing invuln.';
        }
        return cause;
      }
      return null;

    default:
      return null;
  }
}
