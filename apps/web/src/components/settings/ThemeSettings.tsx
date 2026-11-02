import {
  Card,
  CardContent,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Box,
} from '@mui/material';
import {
  LightMode as LightIcon,
  DarkMode as DarkIcon,
  SettingsBrightness as SystemIcon,
} from '@mui/icons-material';

const OPTION_SX = {
  display: 'flex',
  flexDirection: { xs: 'column', sm: 'row' },
  alignItems: 'center',
  gap: { xs: 0.5, sm: 1 },
  px: { xs: 0, sm: 1 },
} as const;

interface ThemeSettingsProps {
  currentTheme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  disabled?: boolean;
}

export function ThemeSettings({
  currentTheme,
  onThemeChange,
  disabled = false,
}: ThemeSettingsProps) {
  const handleChange = (
    _event: React.MouseEvent<HTMLElement>,
    newTheme: 'light' | 'dark' | 'system' | null,
  ) => {
    if (newTheme !== null) {
      onThemeChange(newTheme);
    }
  };

  return (
    <Card id="theme">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Appearance
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            marginBottom: "16px"
          }}>
          Choose how the application looks to you
        </Typography>

        <ToggleButtonGroup
          value={currentTheme}
          exclusive
          onChange={handleChange}
          aria-label="theme selection"
          disabled={disabled}
          fullWidth
          // Three equal buttons that fit a 390px phone: icon over label below
          // 600px, side by side above (content adaptation, not a gate).
          sx={{ mt: 1, maxWidth: 480 }}
        >
          <ToggleButton value="light" aria-label="light mode">
            <Box sx={OPTION_SX}>
              <LightIcon />
              <span>Light</span>
            </Box>
          </ToggleButton>
          <ToggleButton value="dark" aria-label="dark mode">
            <Box sx={OPTION_SX}>
              <DarkIcon />
              <span>Dark</span>
            </Box>
          </ToggleButton>
          <ToggleButton value="system" aria-label="system preference">
            <Box sx={OPTION_SX}>
              <SystemIcon />
              <span>System</span>
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>
      </CardContent>
    </Card>
  );
}
