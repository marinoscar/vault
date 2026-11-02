import {
  Key as KeyIcon,
  VpnKey as VpnKeyIcon,
  CreditCard as CreditCardIcon,
  Token as TokenIcon,
  Description as DescriptionIcon,
  AttachFile as AttachFileIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';

const iconMap: Record<string, React.ElementType> = {
  Key: KeyIcon,
  VpnKey: VpnKeyIcon,
  CreditCard: CreditCardIcon,
  Token: TokenIcon,
  Description: DescriptionIcon,
  AttachFile: AttachFileIcon,
  Category: CategoryIcon,
};

interface SecretTypeIconProps {
  icon: string | null;
  fontSize?: 'small' | 'medium' | 'large';
  color?: 'inherit' | 'primary' | 'secondary' | 'action' | 'disabled';
}

export function SecretTypeIcon({ icon, fontSize = 'medium', color = 'inherit' }: SecretTypeIconProps) {
  const IconComponent = icon ? iconMap[icon] || CategoryIcon : CategoryIcon;
  return <IconComponent fontSize={fontSize} color={color} />;
}

export const availableIcons = Object.keys(iconMap);
