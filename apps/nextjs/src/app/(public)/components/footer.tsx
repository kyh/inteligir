import Link from "next/link";
import { Button, clx, Input, Logo } from "@inteligir/ui";

export const Footer = () => {
  return (
    <footer className="mt-20 border-t border-white/10 sm:mt-24">
      <div className="container max-w-6xl py-10 md:pb-12 md:pt-16">
        <FooterLinksSection />
        <SmallPrintSection />
      </div>
    </footer>
  );
};

const FooterLinksSection = () => {
  return (
    <div className="flex w-full justify-between pb-10 md:pb-12">
      <div className="hidden md:block">
        <Logo />
      </div>
      <div className="flex w-full justify-between md:w-auto md:gap-20">
        <ul>
          <p className="text-ui-fg-base mb-2 text-xs font-semibold">
            Resources
          </p>
          <li>
            <NavLink href="/examples">Examples</NavLink>
          </li>
          <li>
            <NavLink href="/integrations">Integrations</NavLink>
          </li>
        </ul>
        <ul>
          <p className="text-ui-fg-base mb-2 text-xs font-semibold">Company</p>
          <li>
            <NavLink href="/about">About</NavLink>
          </li>
          <li>
            <NavLink href="/legal/terms">Terms of Use</NavLink>
          </li>
          <li>
            <NavLink href="/legal/privacy">Privacy Policy</NavLink>
          </li>
        </ul>
        <ul>
          <p className="text-ui-fg-base mb-2 text-xs font-semibold">Support</p>
          <li>
            <NavLink href="/help">Help center</NavLink>
          </li>
          <li>
            <NavLink href="/contact">Contact</NavLink>
          </li>
        </ul>
      </div>
    </div>
  );
};

export const SmallPrintSection = () => {
  return (
    <div className="flex flex-col items-center justify-between gap-5 border-t border-white/10 pt-8 sm:flex-row">
      <p className="text-ui-fg-muted text-xs">
        &copy; Copyright {new Date().getFullYear()}. All rights reserved.
      </p>
      <div className="flex gap-4">
        <SocialLink href="https://twitter.com/kaiyuhsu" icon={TwitterIcon}>
          Follow on X
        </SocialLink>
        <SocialLink href="https://github.com/kyh" icon={GitHubIcon}>
          Follow on GitHub
        </SocialLink>
        <SocialLink href="https://discord.gg/BGFUs5UpZw" icon={DiscordIcon}>
          Join the Discord server
        </SocialLink>
      </div>
    </div>
  );
};

const EmailSubscriptionSection = () => {
  return (
    <div className="flex flex-col justify-between gap-5 border-t border-white/10 py-8 md:flex-row">
      <div className="w-full md:w-[30%]">
        <p className="text-xs leading-5">
          Subscribe to receive our latest updates right to your inbox 🚀
        </p>
      </div>
      <div className="flex items-center gap-2 md:ml-auto">
        <ConvertkitSignupForm formId="" />
      </div>
    </div>
  );
};

const NavLink = ({
  className,
  ...props
}: React.ComponentProps<typeof Link>) => {
  return (
    <Link
      className={clx(
        "text-ui-fg-subtle hover:text-ui-fg-base -mx-1 block p-1 text-xs capitalize transition",
        className,
      )}
      {...props}
    />
  );
};

const TwitterIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      aria-hidden="true"
      height={14}
      viewBox="0 0 1200 1227"
      width={14}
      {...props}
    >
      <path
        clipRule="evenodd"
        d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"
        fillRule="evenodd"
      />
    </svg>
  );
};

const GitHubIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      aria-hidden="true"
      height={20}
      viewBox="0 0 20 20"
      width={20}
      {...props}
    >
      <path
        clipRule="evenodd"
        d="M10 1.667c-4.605 0-8.334 3.823-8.334 8.544 0 3.78 2.385 6.974 5.698 8.106.417.075.573-.182.573-.406 0-.203-.011-.875-.011-1.592-2.093.397-2.635-.522-2.802-1.002-.094-.246-.5-1.005-.854-1.207-.291-.16-.708-.556-.01-.567.656-.01 1.124.62 1.281.876.75 1.292 1.948.93 2.427.705.073-.555.291-.93.531-1.143-1.854-.213-3.791-.95-3.791-4.218 0-.929.322-1.698.854-2.296-.083-.214-.375-1.09.083-2.265 0 0 .698-.224 2.292.876a7.576 7.576 0 0 1 2.083-.288c.709 0 1.417.096 2.084.288 1.593-1.11 2.291-.875 2.291-.875.459 1.174.167 2.05.084 2.263.53.599.854 1.357.854 2.297 0 3.278-1.948 4.005-3.802 4.219.302.266.563.78.563 1.58 0 1.143-.011 2.061-.011 2.35 0 .224.156.491.573.405a8.365 8.365 0 0 0 4.11-3.116 8.707 8.707 0 0 0 1.567-4.99c0-4.721-3.73-8.545-8.334-8.545Z"
        fillRule="evenodd"
      />
    </svg>
  );
};

const DiscordIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      aria-hidden="true"
      height={20}
      viewBox="0 0 20 20"
      width={20}
      {...props}
    >
      <path d="M16.238 4.515a14.842 14.842 0 0 0-3.664-1.136.055.055 0 0 0-.059.027 10.35 10.35 0 0 0-.456.938 13.702 13.702 0 0 0-4.115 0 9.479 9.479 0 0 0-.464-.938.058.058 0 0 0-.058-.027c-1.266.218-2.497.6-3.664 1.136a.052.052 0 0 0-.024.02C1.4 8.023.76 11.424 1.074 14.782a.062.062 0 0 0 .024.042 14.923 14.923 0 0 0 4.494 2.272.058.058 0 0 0 .064-.02c.346-.473.654-.972.92-1.496a.057.057 0 0 0-.032-.08 9.83 9.83 0 0 1-1.404-.669.058.058 0 0 1-.029-.046.058.058 0 0 1 .023-.05c.094-.07.189-.144.279-.218a.056.056 0 0 1 .058-.008c2.946 1.345 6.135 1.345 9.046 0a.056.056 0 0 1 .059.007c.09.074.184.149.28.22a.058.058 0 0 1 .023.049.059.059 0 0 1-.028.046 9.224 9.224 0 0 1-1.405.669.058.058 0 0 0-.033.033.056.056 0 0 0 .002.047c.27.523.58 1.022.92 1.495a.056.056 0 0 0 .062.021 14.878 14.878 0 0 0 4.502-2.272.055.055 0 0 0 .016-.018.056.056 0 0 0 .008-.023c.375-3.883-.63-7.256-2.662-10.246a.046.046 0 0 0-.023-.021Zm-9.223 8.221c-.887 0-1.618-.814-1.618-1.814s.717-1.814 1.618-1.814c.908 0 1.632.821 1.618 1.814 0 1-.717 1.814-1.618 1.814Zm5.981 0c-.887 0-1.618-.814-1.618-1.814s.717-1.814 1.618-1.814c.908 0 1.632.821 1.618 1.814 0 1-.71 1.814-1.618 1.814Z" />
    </svg>
  );
};

const SocialLink = ({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) => {
  return (
    <NavLink className="group flex items-center" href={href}>
      <span className="sr-only">{children}</span>
      <Icon className="fill-ui-fg-muted group-hover:fill-ui-fg-base transition" />
    </NavLink>
  );
};

const ConvertkitSignupForm = ({ formId }: { formId: string }) => {
  const action = `https://app.convertkit.com/forms/${formId}/subscriptions`;

  return (
    <form
      action={action}
      className="relative w-full md:w-[270px]"
      method="POST"
      target="_blank"
    >
      <Input
        aria-label="Your email address"
        name="email_address"
        placeholder="your@email.com"
        required
        type="email"
      />
      <Button className="absolute right-0 top-0 text-xs">Subscribe</Button>
    </form>
  );
};
