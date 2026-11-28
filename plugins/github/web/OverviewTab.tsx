'use client'

import type { GithubRepoOverview } from '@/lib/github/types'
import { Pill, Row, Section, Status, muted, q, useRemote, when } from './shared'
import { Button } from '@/components/ui/button'

export function OverviewTab({ cwd, go }: { cwd: string; go: (tab: 'prs' | 'issues' | 'actions' | 'releases') => void }) {
  const { data, error, loading, reload } = useRemote<{ repo: GithubRepoOverview }>(`/api/github/repo?${q({ cwd })}`)
  const repo = data?.repo
  return (
    <Status loading={loading && !repo} error={error}>
      {repo ? (
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <a href={repo.url} target="_blank" rel="noreferrer" style={{ fontSize: 18, fontWeight: 600 }}>{repo.repo}</a>
            <Pill>{repo.visibility}</Pill>{repo.isFork ? <Pill>fork</Pill> : null}
            <span style={{ flex: 1 }} /><Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>
          </div>
          {repo.description ? <div style={{ margin: '4px 0' }}>{repo.description}</div> : null}
          <div style={muted}>★ {repo.stars} · ⑂ {repo.forks}{repo.language ? ` · ${repo.language}` : ''}{repo.license ? ` · ${repo.license}` : ''} · pushed {when(repo.pushedAt)}</div>
          <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
            <Button size="sm" variant="outline" onClick={() => go('prs')}>{repo.openPullRequests} open PRs</Button>
            <Button size="sm" variant="outline" onClick={() => go('issues')}>{repo.openIssues} open issues</Button>
            <Button size="sm" variant="outline" onClick={() => go('actions')}>CI runs</Button>
            <Button size="sm" variant="outline" onClick={() => go('releases')}>Releases</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <Section title="Recent commits" count={repo.commits.length}>
              {repo.commits.map((commit) => (
                <Row key={commit.sha}>
                  <a href={commit.url} target="_blank" rel="noreferrer">{commit.message}</a>
                  <div style={muted}>{commit.sha} · {commit.author} · {when(commit.date)}</div>
                </Row>
              ))}
            </Section>
            <Section title="Branches" count={repo.branches.length}>
              {repo.branches.map((branch) => (
                <Row key={branch.name}>
                  {branch.name === repo.currentBranch ? '● ' : ''}{branch.name}
                  {branch.name === repo.defaultBranch ? <Pill>default</Pill> : null}{branch.protected ? <Pill tone="warn">protected</Pill> : null}
                  <span style={muted}> {branch.sha}</span>
                </Row>
              ))}
            </Section>
          </div>
        </div>
      ) : null}
    </Status>
  )
}
