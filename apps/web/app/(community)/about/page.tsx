import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export const metadata = {
  title: 'About',
  description:
    'The PRE Community is a public, community-funded effort to rebuild decentralized search.',
};

interface AboutSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

function AboutSection({ id, title, children }: AboutSectionProps) {
  return (
    <section className="about-section" aria-labelledby={id}>
      <h2 className="about-section-heading" id={id}>
        {title}
      </h2>
      <div className="about-section-copy">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main>
      <article className="border-b border-line">
        <header className="about-hero">
          <h1 className="about-title">About</h1>
        </header>

        <AboutSection id="what-happened" title="01 / What happened">
          <p>
            On July 24, 2026, Presearch announced it was shutting down, effective immediately. Users
            were given four days to withdraw. Support closed a week after that.
          </p>
          <p>
            The stated reason was that the platform never reached one million legitimate daily
            searches - the threshold its operators believed would have made it sustainable.
          </p>
          <p>
            We are not here to debate that. The people who ran Presearch made their assessment and
            acted on it. What matters now is that a nine-year effort to build an alternative to
            monopoly search went dark, and a lot of people who gave it time, money, computing power,
            and daily habit were left with nothing to show for it.
          </p>
          <p>
            That is the honest starting position. Anything written here that ignores it isn’t worth
            reading.
          </p>
        </AboutSection>

        <AboutSection id="what-survived" title="02 / What survived">
          <p>Three things.</p>
          <p>
            <strong>The problem.</strong> One company still decides what most of the world can find.
            Search still runs on surveillance by default. Nothing about the last nine years made
            that less true.
          </p>
          <p>
            <strong>The token.</strong> PRE is an ERC-20 contract on Ethereum and Base. It does not
            depend on any company’s servers, hosting bill, or continued existence. It was there
            before the shutdown and it is there now.
          </p>
          <p>
            <strong>The people.</strong> Node operators who ran infrastructure for years. Developers
            who wrote code. Users who changed their default search engine and never changed it back.
            That’s a network, and networks don’t dissolve because a corporate entity does.
          </p>
        </AboutSection>

        <AboutSection id="who-we-are" title="03 / Who we are">
          <p>
            Long-time community members. Some of us were here in 2017 and worked on the original
            platform. Some arrived years later as node operators, developers, or people who simply
            refused to go back to Google.
          </p>
          <p>
            We are not a company. There is no funding round, no board, no cap table. This is a
            grassroots effort, and we intend to keep it that way for as long as it’s workable.
          </p>
          <p>
            We are not publishing a roster of names right now. Not to hide - but because we think a
            list of names is the weakest form of accountability on offer, and we’d rather earn trust
            the expensive way. Every contribution to this effort is recorded on-chain. Every release
            of funds is tied to a confirmed event with a block explorer link. You do not have to
            believe anything we say about ourselves. You can check the ledger.
          </p>
          <p>Names will follow work. Not the other way around.</p>
        </AboutSection>

        <AboutSection id="what-were-building" title="04 / What we’re building">
          <p>
            <strong>First: this platform.</strong> A place where the community can propose work,
            argue about it in public, fund what it wants funded, and watch the money move. This has
            to exist before anything else does, because everything else depends on being able to
            organize and pay for work without a company in the middle.
          </p>
          <p>
            <strong>Second: the search engine.</strong> A community member has already built a
            working decentralized search aggregator on Nostr. It runs entirely in the browser. There
            is no backend to pay for, no crawler farm, no central index to maintain. Every search
            checks a Nostr-hosted cache first, then queries multiple providers in parallel, then
            publishes what it finds back to Nostr - so the next person’s search is faster because
            you ran yours. The code is open source under an MIT license. Anyone who wants to run the
            full self-hosted stack instead can.
          </p>
          <p>
            This matters more than it sounds. The single hardest constraint on the old platform was
            that decentralized search was being delivered by expensive centralized infrastructure.
            That contradiction is now solvable in a way it wasn’t in 2017. A search layer that costs
            almost nothing to operate cannot be shut down by a hosting invoice.
          </p>
          <p>
            <strong>Third: Community Search Engines.</strong> Custom-branded search engines that
            non-technical people can launch and run themselves - for a town, a trade, a language, a
            community of interest. Fees for this are paid in PRE.
          </p>
          <p>
            The full roadmap is still being developed, in public, with input from anyone who shows
            up. We would rather publish three milestones we can actually fund than twelve we can’t.
          </p>
        </AboutSection>

        <AboutSection id="where-pre-fits" title="05 / Where PRE fits">
          <p>PRE is the working currency of this system, not a bet on it.</p>
          <p>
            It pays fees for Community Search Engines. It carries weight in governance through
            staking. It funds specific development goals through this platform. In certain cases it
            rewards contributed work.
          </p>
          <p>
            We make no claims, projections, or promises about the price or future value of PRE, and
            nothing on this site should be read as investment advice or as an offer to sell
            anything. If you contribute here, contribute because you want the work done.
          </p>
        </AboutSection>

        <AboutSection id="how-money-works" title="06 / How the money works">
          <p>
            Every funding goal begins with a confirmed on-chain event. Contributions and releases
            are copied from the ledger, not from our accounting. PRE and USDC stay in their native
            units - no invented conversions, no blended totals that flatter anyone.
          </p>
          <p>
            Contributions are held in escrow against specific, named goals. Funds release against
            completed work, after a confirmation gate. Surplus is reported, not absorbed. Every
            movement carries a block explorer link.
          </p>
          <p>Monthly reports are exportable by anyone, at any time, without asking us.</p>
          <p>
            This is deliberately the most boring possible way to handle money. That’s the point.
          </p>
        </AboutSection>

        <AboutSection id="how-decisions-are-made" title="07 / How decisions get made">
          <p>
            You can propose a project. You can comment on anyone else’s. You can vote. You can
            direct your funding at the specific work you want to see and refuse the work you don’t.
          </p>
          <p>
            Voting weight comes from staked PRE and from a record of contribution. People who show
            up and do the work carry more weight over time than people who arrive to vote once.
          </p>
          <p>
            The finances are fully transparent by construction. Not “we publish quarterly summaries”
            - the ledger <em>is</em> the accounting, and it is public before we see it.
          </p>
        </AboutSection>

        <AboutSection id="what-contributing-gets-you" title="08 / What contributing gets you">
          <p>
            Standing in the governance of the project, weighted into your voting power. PRE rewards,
            in defined circumstances. Credit - your name and link on the page describing the work
            you helped fund.
          </p>
          <p>
            That is the complete list. You are not buying a share of anything. You are paying for
            work you want to exist, in public, with a receipt.
          </p>
        </AboutSection>

        <AboutSection
          id="to-everyone-who-lost-something"
          title="09 / To everyone who lost something"
        >
          <p>
            Node license holders. Keyword stakers. People who accumulated search rewards for six
            years and found nothing withdrawable when the window opened.
          </p>
          <p>
            We’re not going to pretend this effort makes you whole. It doesn’t, and anyone telling
            you otherwise is selling something. We have no access to the old company’s books, no
            authority over its decisions, and no ability to reverse them.
          </p>
          <p>
            What we can do is refuse to rebuild the conditions that caused it. Costs low enough that
            the platform survives a bad year. Books open enough that nobody has to guess. A codebase
            that is open source, forkable, and not dependent on our continued goodwill or existence.
            Decisions made by the people who show up rather than announced to them.
          </p>
          <p>
            If this effort fails, we want it to fail in public, slowly, with everyone able to see it
            coming.
          </p>
        </AboutSection>

        <AboutSection id="what-we-are-not-promising" title="10 / What we are not promising">
          <p>
            No claims about token price. No investment returns. No relaunch date we can’t back with
            funded work. No roadmap items without a funding goal attached. No closed-door decisions.
            No treasury you can’t inspect.
          </p>
          <p>
            We are rising from the ashes of Presearch, and we are not pretending to be Presearch.
            What this becomes, and what it ends up called, will be decided by the people who build
            it.
          </p>
        </AboutSection>
      </article>

      <section className="about-cta">
        <div>
          <span className="about-cta-label">Join the process</span>
          <h2 className="about-cta-title">Begin with a useful discussion.</h2>
        </div>
        <Link className="about-cta-link" href="/community">
          Open Community <ArrowUpRight size={17} />
        </Link>
      </section>
    </main>
  );
}
