import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import App from '../App';

// MemoryRouter (not BrowserRouter) deliberately: src/__tests__/setup.ts
// replaces `window.location` with a static plain object for other tests'
// convenience, which is incompatible with BrowserRouter's use of the real
// History API. Under BrowserRouter + that mock, ProtectedRoute's redirect to
// /login never registers as a location change, so it re-renders in an
// infinite loop ("Maximum update depth exceeded"). MemoryRouter keeps its
// own in-memory history and isn't affected, and is the standard choice for
// router-dependent component tests anyway.
describe('App', () => {
  it('renders the authenticated home page when the session refresh succeeds', async () => {
    // The default MSW handlers (see mocks/handlers.ts) mock a successful
    // POST /auth/refresh + GET /auth/me, so App's auth bootstrap resolves to
    // an authenticated user and the router lands on HomePage ("/").
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole('heading', { name: /^good (morning|afternoon|evening)/i }),
        ).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('renders the login page when there is no valid session', async () => {
    // Simulate an unauthenticated visitor: refresh fails, so AuthContext
    // never calls GET /auth/me and isAuthenticated stays false, which the
    // router resolves to LoginPage.
    server.use(
      http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
  });
});
