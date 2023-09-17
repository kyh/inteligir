"use client";
/* eslint-disable react/no-unescaped-entities */
import { cn } from "ui/lib/cn";
import NextLink from "next/link";
import { useCallback, useState } from "react";
import { Button } from "ui/components/button";
import { Tabs } from "ui/components/tabs";
import {
  type LucideIcon,
  ArrowLeft,
  ArrowRight,
  BarChart,
  DollarSign,
  Globe,
  Lock,
  Table,
} from "ui/icons";
import { TabsContent, TabsList, TabsTrigger } from "ui/components/tabs";

const MultilineCode = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex w-full flex-col rounded border bg-gray-100 px-4 py-3 font-mono">
      {children}
    </div>
  );
};

const InlineCode = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <code
    className={cn(
      "whitespace-pre-line rounded bg-gray-100 px-[5px] py-[2px] text-gray-900",
      className,
    )}
  >
    {children}
  </code>
);

const Link = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <NextLink
    className="text-blue-500 underline hover:text-blue-400"
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
  </NextLink>
);

const StepCard = ({
  stepNum,
  name,
  icon: Icon,
  onGoToStep,
  currentStep,
}: {
  name: SetupStep;
  stepNum: number;
  icon: LucideIcon;
  currentStep: SetupStep;
  onGoToStep: (stepName: SetupStep) => void;
}) => {
  const selected = name === currentStep;
  return (
    <div
      className={cn(
        "relative w-36 cursor-pointer rounded border bg-white px-4 py-2 shadow-sm transition hover:shadow",
        {
          "border-primary-500 bg-primary-50": selected,
        },
      )}
      onClick={() => onGoToStep(name)}
    >
      <div className="z-10">
        <p
          className={cn("font-base mb-4 text-xl", {
            "text-gray-500 ": !selected,
            "text-primary-900 ": selected,
          })}
        >
          {stepNum}
        </p>
        <p
          className={cn("font-mono text-lg font-medium", {
            "text-gray-500": !selected,
            "text-primary-900": selected,
          })}
        >
          {name}
        </p>
      </div>
      <div
        className={cn("absolute right-2.5 top-2.5", {
          "text-gray-500 ": !selected,
          "text-primary-900 ": selected,
        })}
      >
        <Icon className="h-6 w-6" />
      </div>
    </div>
  );
};

export const SETUP_STEPS: {
  path: string;
  name: SetupStep;
  icon: LucideIcon;
  content: React.ComponentType<{}>;
}[] = [
  {
    path: "hosting",
    name: "Hosting",
    icon: Globe,
    content: HostingContent,
  },
  {
    path: "database",
    name: "Database",
    icon: Table,
    content: DatabaseContent,
  },
  {
    path: "auth",
    name: "Auth",
    icon: Lock,
    content: AuthContent,
  },
  {
    path: "billing",
    name: "Billing",
    icon: DollarSign,
    content: BillingContent,
  },

  // {
  //   path: "email",
  //   name: "Email",
  //   icon: Mail,
  //   content: EmailContent,
  // },
  {
    path: "analytics",
    name: "Analytics",
    icon: BarChart,
    content: AnalyticsContent,
  },
  // {
  //   path: "wrap-up",
  //   name: "Wrap up",
  //   icon: Rocket,
  //   content: WrapUpContent,
  // },
];

export type SetupStep =
  | "Hosting"
  | "Database"
  | "Auth"
  | "Billing"
  | "Email"
  | "Analytics"
  | "Wrap up";

export default function Setup() {
  const handleSelectCard = useCallback((name: string) => {
    const step = SETUP_STEPS.find((s) => s.name === name);
    if (!step) return;
    setSetupStep(step.name);
  }, []);

  const [setupStep, setSetupStep] = useState("Hosting");
  const stepIdx = SETUP_STEPS.findIndex((s) => s.name === setupStep);
  const step = SETUP_STEPS[stepIdx];

  if (!step) return null;

  return (
    <div className="flex w-full gap-8 px-4">
      <div className="flex flex-col flex-wrap gap-4">
        {SETUP_STEPS.map(({ name, icon }, i) => (
          <StepCard
            key={i}
            stepNum={i + 1}
            currentStep={step.name}
            name={name}
            icon={icon}
            onGoToStep={handleSelectCard}
          />
        ))}
      </div>
      <div className="flex max-w-3xl flex-col">
        {/* <p className="mb-4 font-mono text-xl font-medium">{step.name}</p> */}
        <div className="mb-8 max-w-2xl leading-relaxed">
          <step.content />
        </div>
        <div className="flex items-center justify-between">
          {stepIdx > 1 ? (
            <Button
              onClick={() => handleSelectCard(SETUP_STEPS[stepIdx - 1]!.name)}
              className="self-start"
            >
              <ArrowLeft className="mr-1 w-4" />
              Previous
            </Button>
          ) : (
            <div />
          )}
          {stepIdx < SETUP_STEPS.length - 1 && (
            <Button
              onClick={() => handleSelectCard(SETUP_STEPS[stepIdx + 1]!.name)}
              className="self-start"
            >
              Next
              <ArrowRight className="ml-1 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContentBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col space-y-2", className)}>{children}</div>
  );
}

function HostingContent() {
  return (
    <ContentBlock>
      <p>
        Inteligir uses Vercel to host your app. If you're not familiar with
        Vercel, check out their{" "}
        <Link href="https://vercel.com/docs">tutorial</Link> on how to setup a
        project.
      </p>
      <p>For our purposes, we'll be using the CLI to setup our project:</p>
      <MultilineCode>
        cd @/your-repo
        <br />
        npm i -g vercel
        <br />
        npm install
        <br />
        vercel login
        <br />
        vercel link
        <br />
        npm run dev
      </MultilineCode>
      <p>
        Over the next steps, we'll be adding multiple environment variables to
        Vercel and then pulling them down into our local environment. For the
        purposes of this tutorial, we'll assume everything is "production."
      </p>

      <p>
        If you're not sure on how to add environment variables to Vercel, check
        out their{" "}
        <Link href="https://vercel.com/guides/how-to-add-vercel-environment-variables">
          documentation
        </Link>{" "}
        here. For the purposes of this onboarding, just check all three
        environments (Production, Preview, and Development).
      </p>
      <p>
        Once you've added the env var, pull your variable down to your local dev
        environment by running <InlineCode>vercel env pull</InlineCode>. If
        you've set your env var correctly, you will see your env variables in
        your <InlineCode>.env.local</InlineCode> file and the display below will
        show the value.
      </p>
    </ContentBlock>
  );
}

function DatabaseContent() {
  return (
    <ContentBlock>
      <p>
        Inteligir uses Supabase Database (i.e. Postgres). We want to set the{" "}
        <InlineCode>NEXT_PUBLIC_SUPABASE_URL</InlineCode> and{" "}
        <InlineCode>NEXT_PUBLIC_SUPABASE_ANON_KEY</InlineCode> variables. to get
        started.
      </p>

      <p>
        You'll need to create a{" "}
        <Link href="https://app.supabase.com/">Supabase</Link> account and
        project. Once you've created your project, you'll need both your
        project's <InlineCode>URL</InlineCode> and your anonymous key. You can
        find both of these in your project's <InlineCode>API</InlineCode> tab.
        Set those environment variables in Vercel and pull them down to your
        local environment.
      </p>
      <p>
        Now, add your Supabase API values to Vercel by adding two environment
        variables: <InlineCode>NEXT_PUBLIC_SUPABASE_ANON_KEY</InlineCode> and{" "}
        <InlineCode>NEXT_PUBLIC_SUPABASE_URL</InlineCode>. Once you've added the
        env var, pull your variable down to your local dev environment using{" "}
        <InlineCode>vercel env pull .env.local</InlineCode>. If you've set your
        env vars correctly, you should see both your Supabase URL and anonymous
        key in your <InlineCode>.env.local</InlineCode> file.
      </p>
      <p>
        Next, let's set up your tables. We're going to do this with a series of
        SQL commands. You can run these commands in the SQL editor in your
        Supabase project.
      </p>
      <Tabs defaultValue="profiles" id="db-host">
        <TabsList>
          <TabsTrigger value="profiles">profiles</TabsTrigger>
          <TabsTrigger value="teams">teams</TabsTrigger>
          <TabsTrigger value="members">members</TabsTrigger>
          <TabsTrigger value="invites">invites</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              create table public.profiles (
              <br />
              id uuid not null references auth.users on delete cascade,
              <br />
              full_name text,
              <br />
              email text not null,
              <br />
              has_onboarded boolean default false not null,
              <br />
              primary key (id)
              <br />
              );
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="teams" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              create table public.teams (
              <br />
              id bigint generated by default as identity primary key,
              <br />
              created_at timestamp with time zone default timezone('utc'::text,
              now()) not null,
              <br />
              name text not null);
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="members" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              create table public.members (
              <br />
              id bigint generated by default as identity primary key,
              <br />
              created_at timestamp with time zone default timezone('utc'::text,
              now()) not null,
              <br />
              team_id bigint not null references public.teams on delete cascade,
              <br />
              user_id uuid not null references auth.users on delete cascade,
              <br />
              role text check (role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text,
              'MEMBER'::text])) not null default 'MEMBER'::text );
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="invites" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              create table public.invites (
              <br />
              id bigint generated by default as identity primary key,
              <br />
              created_at timestamp with time zone default timezone('utc'::text,
              now()) not null,
              <br />
              team_id bigint not null references public.teams on delete cascade,
              <br />
              role text check (role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text,
              'MEMBER'::text])) not null default 'MEMBER'::text,
              <br />
              joined boolean default false not null,
              <br />
              email text not null,
              <br />
              unique (team_id, email)
              <br />
              );
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
      </Tabs>
      <p>
        Finally, let's set up your RLS for each of the tables above. We're going
        to do this with a series of SQL commands again. You can once again run
        these commands in the SQL editor in your Supabase project.
      </p>
      <Tabs defaultValue="profiles" id="db-host">
        <TabsList>
          <TabsTrigger value="profiles">profiles</TabsTrigger>
          <TabsTrigger value="teams">teams</TabsTrigger>
          <TabsTrigger value="members">members</TabsTrigger>
          <TabsTrigger value="invites">invites</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              alter table public.profiles enable row level security;
              <br />
              <br />
              create policy profiles_select on public.profiles
              <br />
              for select
              <br />
              to public
              <br />
              using (true);
              <br />
              <br />
              create policy profiles_insert on public.profiles
              <br />
              for insert
              <br />
              to public
              <br />
              with check (auth.uid() = id);
              <br />
              <br />
              create policy profiles_update on public.profiles
              <br />
              for update
              <br />
              to public
              <br />
              using (auth.uid() = id);
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="teams" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              alter table public.teams enable row level security;
              <br />
              <br />
              create policy teams_all_if_member on public.teams
              <br />
              for all
              <br />
              to public
              <br />
              using (exists ( select 1 from members where ((members.team_id =
              teams.id) and (members.user_id = auth.uid()))))
              <br />
              with check (exists ( select 1 from members where ((members.team_id
              = teams.id) and (members.user_id = auth.uid()))));
              <br />
              <br />
              create policy teams_insert_auth on public.teams
              <br />
              for insert
              <br />
              to authenticated
              <br />
              with check (true);
              <br />
              <br />
              create policy teams_select_auth on public.teams
              <br />
              for select
              <br />
              to authenticated
              <br />
              using (true);
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="members" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              alter table public.members enable row level security;
              <br />
              <br />
              create policy members_all_auth on public.members
              <br />
              for all
              <br />
              to authenticated
              <br />
              using (user_id = auth.uid())
              <br />
              with check (user_id = auth.uid());
              <br />
              <br />
              create policy members_insert_auth on public.members
              <br />
              for insert
              <br />
              to authenticated
              <br />
              with check (true);
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
        <TabsContent value="invites" className="bg-white">
          <ContentBlock>
            <MultilineCode>
              alter table public.invites enable row level security;
              <br />
              <br />
              create policy invites_all_auth on public.invites
              <br />
              for all
              <br />
              to authenticated
              <br />
              using (true)
              <br />
              with check (true);
              <br />
              <br />
              create policy invites_insert_auth on public.invites
              <br />
              for insert
              <br />
              to authenticated
              <br />
              with check (true);
            </MultilineCode>
          </ContentBlock>
        </TabsContent>
      </Tabs>
    </ContentBlock>
  );
}

function AuthContent() {
  return (
    <ContentBlock>
      <p>
        Inteligir uses Supabase Auth to handle magic link and multiple providers
        for authentication.{" "}
      </p>

      <p>
        Now, we need to add our production URL to our Supabase project. Go to
        the Auth tab in your Supabase project and add your production URL to the
        URL Configuration section under Auth Settings.
      </p>

      <p>
        Then add the following redirect URLs to your Supabase Auth settings to
        handle local and production development:
        <ul className="list-inside list-disc">
          <li>
            <InlineCode>http://localhost:3000/**</InlineCode>
          </li>
          <li>
            <InlineCode>https://*-domain.vercel.app/**</InlineCode>
          </li>
          <li>
            <InlineCode>https://*.domain.com/**</InlineCode>
          </li>
        </ul>
      </p>
      <p className="">
        Supabase automatically handles emails via their email templates. To set
        up your own custom email provider based auth, you'll need some SMTP info
        from your mail provider (eg. Mailgun, Sendgrid, Postmark, etc.). You'll
        need an SMTP host, port, user and password. Add these values into the
        respective env vars in Supabase's Auth page under Settings.
      </p>
      <p>
        Then let's set up a Postgres trigger to automatically create a profile
        with an onboarding status when a new user is created.
      </p>
      <MultilineCode>
        -- inserts a row into public.profiles
        <br />
        create function public.handle_new_user()
        <br />
        returns trigger
        <br />
        language plpgsql
        <br />
        security definer set search_path = public
        <br />
        as $$
        <br />
        begin
        <br />
        insert into public.profiles (id, email)
        <br />
        values (new.id, new.email);
        <br />
        return new;
        <br />
        end;
        <br />
        $$;
        <br />
        -- trigger the function every time a user is created
        <br />
        create trigger on_auth_user_created
        <br />
        after insert on auth.users
        <br />
        for each row execute procedure public.handle_new_user();
      </MultilineCode>
    </ContentBlock>
  );
}

function BillingContent() {
  return (
    <ContentBlock>
      <p>
        Inteligir uses Stripe to handle billing. Once you've connected Stripe,
        customers can manage their payments from the Stripe billing portal on
        the <InlineCode>/billing</InlineCode> page.
      </p>
      <p>
        To set up Stripe, add the following environment variable:{" "}
        <InlineCode>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</InlineCode>.{" "}
      </p>
      <p>
        Inteligir uses Stripe Pricing Table to show available products and
        prices. Setup the following environment variables in Vercel and pull.
      </p>
      <p>
        To set up pricing table, add the following environment variable:{" "}
        <InlineCode>NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID</InlineCode>.
      </p>
    </ContentBlock>
  );
}

function EmailContent() {
  return (
    <ContentBlock>
      <p>
        Scalerepo uses <Link href="https://react.email">react.email</Link> and
        nodemailer to write and send emails respectively. If you've already set
        up email based authentication, you can skip this step as they both rely
        on the same SMTP environment variables.
      </p>
      <p className="">
        To set up emails, you'll need some SMTP info from your mail provider
        (eg. Mailgun, Sendgrid, Postmark, etc.). You'll need an SMTP host, port,
        user and password. Add these values into the respective env vars in
        vercel.
      </p>

      <p>
        Follow the code in <InlineCode>/src/server/api/email.tsx</InlineCode> to
        see how emails are loaded and sent.
      </p>
      <p>
        To configure the email your app sends from, edit the constant in{" "}
        <InlineCode>src/lib/emailFrom.ts</InlineCode>
      </p>
    </ContentBlock>
  );
}

function AnalyticsContent() {
  return (
    <ContentBlock>
      <p>
        Inteligir uses Posthog to track analytics. Posthog has a very generous
        free tier and it's very easy to connect. Sign up for an account and put
        in their provided API key into the{" "}
        <InlineCode>NEXT_PUBLIC_POSTHOG_KEY</InlineCode>
      </p>

      <p>
        If you want to use a different analytics provider, it's straightforward
        to search for instances of <InlineCode>posthog?.capture</InlineCode> or{" "}
        <InlineCode>posthog()?.identify</InlineCode>
        and replace it with another call.
      </p>
    </ContentBlock>
  );
}

function WrapUpContent() {
  return (
    <ContentBlock>
      <p>
        You're all set with all the features Inteligir comes out of the box.
      </p>
    </ContentBlock>
  );
}
