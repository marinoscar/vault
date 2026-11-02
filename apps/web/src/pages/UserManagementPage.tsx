import { useState } from 'react';
import { Container, Typography, Box, Tabs, Tab, Paper } from '@mui/material';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { UserList } from '../components/admin/UserList';
import { AllowlistTable } from '../components/admin/AllowlistTable';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: { xs: 2, sm: 3 } }}>{children}</Box>}
    </div>
  );
}

/**
 * The `Users & allowlist` card of the Console (`/admin/settings/users`; the
 * old `/admin/users` redirects here, E10.3 #94). Two tabs for genuinely
 * parallel content in one destination (Settings UI Pattern rule 2). Replaced
 * by the packaged identity page in E3.3.
 */
export default function UserManagementPage() {
  const { hasPermission } = usePermissions();
  const [tabIndex, setTabIndex] = useState(0);

  // Check permission - require users:read to access
  if (!hasPermission('users:read')) {
    return <Navigate to="/" replace />;
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Users &amp; allowlist
        </Typography>
        <Typography
          sx={{
            color: "text.secondary",
            marginBottom: "16px"
          }}>
          Manage users and email allowlist
        </Typography>

        <Paper sx={{ mt: 2 }}>
          <Tabs
            value={tabIndex}
            onChange={(_, newValue) => setTabIndex(newValue)}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Users" />
            <Tab label="Allowlist" />
          </Tabs>

          <Box sx={{ p: { xs: 1, sm: 3 } }}>
            <TabPanel value={tabIndex} index={0}>
              <UserList />
            </TabPanel>

            <TabPanel value={tabIndex} index={1}>
              <AllowlistTable />
            </TabPanel>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
