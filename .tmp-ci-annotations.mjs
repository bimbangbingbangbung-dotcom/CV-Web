// Temporary CI diagnostic helper (deleted after use).
const base = 'https://api.github.com/repos/bimbangbingbangbung-dotcom/CV-Web';
const runs = await (await fetch(base + '/actions/runs?per_page=3')).json();
const run = runs.workflow_runs.find((r) => r.name === 'CI');
if (!run) {
  console.log('no CI run found');
  process.exit(0);
}
console.log('CI', run.head_sha.slice(0, 7), run.conclusion, run.id);
if (run.conclusion !== 'failure') process.exit(0);
const jobs = await (await fetch(base + '/actions/runs/' + run.id + '/jobs')).json();
for (const job of jobs.jobs) {
  console.log('JOB:', job.name, job.conclusion);
  if (job.conclusion !== 'failure') continue;
  for (const s of job.steps) {
    if (s.conclusion !== 'success' && s.conclusion !== 'skipped') {
      console.log('  STEP FAIL:', s.name, s.conclusion);
    }
  }
  const ann = await (await fetch(base + '/check-runs/' + job.id + '/annotations')).json();
  if (Array.isArray(ann)) {
    for (const a of ann.slice(0, 8)) {
      console.log('---', a.annotation_level + ':', a.message.slice(0, 2000));
    }
  }
}
