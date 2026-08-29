export const socialImageAlt = 'PRE community - public, community-funded decentralized search.';
export const socialImageSize = { width: 1200, height: 630 };
const socialImageDomain = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3011').host;

function SocialBrandMark() {
  return (
    <svg width="46" height="46" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#2d8eff" />
      <g fill="#ffffff">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7 16.5h5.7c3.9 0 6.2 2.1 6.2 5.45s-2.3 5.45-6.2 5.45h-2v4.1H7v-15Zm3.7 3.25v4.4h1.8c1.75 0 2.65-.75 2.65-2.2s-.9-2.2-2.65-2.2h-1.8Z"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M19.3 16.5H25c3.9 0 6.2 2.05 6.2 5.3 0 2.2-1.05 3.85-2.95 4.7l3.45 5h-4.3l-2.8-4.25H23v4.25h-3.7v-15Zm3.7 3.25v4.3h1.8c1.75 0 2.65-.75 2.65-2.15s-.9-2.15-2.65-2.15H23Z"
        />
        <path d="M32.7 16.5H41v3.3h-4.7v2.5h4.25v3.2H36.3v2.7H41v3.3h-8.3v-15Z" />
      </g>
    </svg>
  );
}

export function SocialCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#f8fbff',
        color: '#091c33',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          height: 84,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 56px',
          borderBottom: '1px solid #c0ddff',
          background: '#f8fbff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <SocialBrandMark />
          <span style={{ marginLeft: 13, fontSize: 24, fontWeight: 700, letterSpacing: '-0.8px' }}>
            community
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 34,
            color: '#5b6f86',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          <span style={{ color: '#091c33' }}>Home</span>
          <span>Community</span>
          <span>Funding</span>
          <span>About</span>
        </div>
        <div
          style={{
            display: 'flex',
            color: '#2d8eff',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.8px',
          }}
        >
          {socialImageDomain}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          overflow: 'hidden',
          padding: '58px 56px 46px',
          background: '#091c33',
          color: '#ffffff',
        }}
      >
        <span
          style={{
            position: 'absolute',
            right: -24,
            bottom: -80,
            color: '#102a49',
            fontSize: 286,
            fontWeight: 800,
            lineHeight: 0.75,
            letterSpacing: '-24px',
          }}
        >
          PRE
        </span>

        <div
          style={{
            position: 'relative',
            width: 770,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <span
            style={{ fontSize: 76, fontWeight: 800, lineHeight: 0.96, letterSpacing: '-4.8px' }}
          >
            PRE community
          </span>
          <span
            style={{
              width: 690,
              marginTop: 22,
              fontSize: 27,
              fontWeight: 700,
              lineHeight: 1.28,
              letterSpacing: '-0.7px',
            }}
          >
            The PRE Community is a public, community-funded effort to rebuild decentralized search -
            in the open, on a ledger anyone can audit.
          </span>
        </div>

        <div
          style={{
            position: 'relative',
            width: 280,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            marginLeft: 'auto',
            paddingLeft: 34,
            borderLeft: '1px solid #36516f',
          }}
        >
          <span style={{ color: '#2d8eff', fontSize: 13, fontWeight: 700, letterSpacing: '1.8px' }}>
            PUBLIC RECORD
          </span>
          <span
            style={{
              marginTop: 20,
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: '-3px',
            }}
          >
            BASE
          </span>
          <span style={{ marginTop: 8, color: '#a9bfd8', fontSize: 20 }}>Sepolia</span>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 34,
              paddingTop: 12,
              borderTop: '1px solid #36516f',
              color: '#a9bfd8',
              fontSize: 13,
            }}
          >
            <span>Community</span>
            <span style={{ color: '#ffffff' }}>Open</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 11,
              paddingTop: 11,
              borderTop: '1px solid #233d5a',
              color: '#a9bfd8',
              fontSize: 13,
            }}
          >
            <span>Funding</span>
            <span style={{ color: '#ffffff' }}>On-chain</span>
          </div>
        </div>
      </div>
    </div>
  );
}
