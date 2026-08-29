import { MetadataStatus } from '@precommunity/database';
import { isValidIpfsUri } from '@precommunity/shared';

export interface ProfileProjection {
  id: string;
  active: boolean;
  revision: bigint;
  displayName: string | null;
  websiteUrl: string | null;
  avatarUri: string | null;
  avatarStatus: MetadataStatus;
  bio: string | null;
  defaultPublic: boolean;
  hidden: boolean;
}

export function shortenedAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function visibleProfile(profile: ProfileProjection | null | undefined) {
  return profile?.active && !profile.hidden ? profile : null;
}

export function profileAvatarPath(address: string, profile: ProfileProjection | null | undefined) {
  const visible = visibleProfile(profile);
  if (
    !visible?.avatarUri ||
    visible.avatarStatus === MetadataStatus.INVALID ||
    !isValidIpfsUri(visible.avatarUri)
  )
    return null;
  return `/v1/public/profiles/${encodeURIComponent(address)}/avatar?revision=${visible.revision.toString()}`;
}

export function publicAuthorProfile(
  address: string,
  profile: ProfileProjection | null | undefined,
) {
  const visible = visibleProfile(profile);
  return {
    address,
    displayName: visible?.displayName ?? null,
    avatarUrl: profileAvatarPath(address, visible),
    websiteUrl: visible?.websiteUrl?.startsWith('https://') ? visible.websiteUrl : null,
  };
}
