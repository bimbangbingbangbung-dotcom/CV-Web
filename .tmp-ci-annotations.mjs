// Temporary CI diagnostic helper (deleted after use).
const base = 'https://api.github.com/repos/bimbangbingbangbung-dotcom/CV-Web';
const runs = await (await fetch(base + '/actions/runs?per_page=4')).json();
const run = runs.workflow_runs.find((r) => r.name === 'Deploy' && r.conclusion === 'failure');
if (!run) {
  console.log('no failed Deploy run found');
  process.exit(0);
}
console.log('Deploy', run.head_sha.slice(0, 7), run.conclusion, run.id);
const jobs = await (await fetch(base + '/actions/runs/' + run.id + '/jobs')).json();
for (const job of jobs.jobs) {
  console.log('JOB:', job.name, job.conclusion);
  for (const s of job.steps) {
    if (s.conclusion !== 'success' && s.conclusion !== 'skipped') {
      console.log('  STEP FAIL:', s.name, s.conclusion);
    }
  }
}
