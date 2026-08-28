// Automations module: Shay's Skills Leash. Thin binding over
// server/kernel/skills.js -- see that file for why every card here is
// honest rather than the fabricated stats the cockpit mockup shows.
import { listSkills, killSwitch } from '../../kernel/skills.js';

export default {
  name: 'automations',
  register({ app }) {
    // Global scope: this is a portfolio-wide capability list, not any one
    // site's state (convention 5 only requires site_id on requests that
    // read or write site state).
    app.route('GET', '/api/automations', async () => {
      const skills = listSkills();
      return {
        status: 200,
        body: {
          status: 'available',
          source: 'skills kernel (listSkills())',
          skills,
          kill_switch: killSwitch(),
        },
      };
    }, { scope: 'global' });
  },
};
