import { useEffect, useState } from 'react';
import { getAgentActivity, type AgentActivityItem, type AgentActivityQuery } from './agentActivity.js';

export interface UseAgentActivityResult {
  items: AgentActivityItem[];
  total: number;
  loading: boolean;
  error: string | null;
}

/** Loads one page of agent activity whenever the query changes; only the latest request writes state. */
export function useAgentActivity(query: AgentActivityQuery): UseAgentActivityResult {
  const [state, setState] = useState<UseAgentActivityResult>({ items: [], total: 0, loading: true, error: null });
  const key = JSON.stringify(query);

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    getAgentActivity(JSON.parse(key) as AgentActivityQuery)
      .then((page) => {
        if (current) setState({ items: page.items, total: page.total, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (current) {
          setState({
            items: [],
            total: 0,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load agent activity',
          });
        }
      });
    return () => {
      current = false;
    };
  }, [key]);

  return state;
}
