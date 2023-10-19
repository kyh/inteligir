import {
  Body,
  Button,
  Container,
  Column,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
  Tailwind,
  render,
} from "@react-email/components";

type Props = {
  organizationName: string;
  organizationLogo?: string;
  inviter?: string;
  invitedUserEmail: string;
  link: string;
  productName: string;
};

export default function renderInviteEmail(props: Props) {
  const previewText = `Join ${props.invitedUserEmail} on ${props.productName}}`;

  return render(
    <Html>
      <Head />
      <Preview>{previewText}</Preview>

      <Tailwind>
        <Body className="mx-auto my-auto bg-gray-50 font-sans">
          <Container className="mx-auto my-[40px] w-[465px] rounded-lg border border-solid border-[#eaeaea] bg-white p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              Join <strong>{props.organizationName}</strong> on{" "}
              <strong>{props.productName}</strong>
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              Hello {props.invitedUserEmail},
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              <strong>{props.inviter}</strong> has invited you to the{" "}
              <strong>{props.organizationName}</strong> team on{" "}
              <strong>{props.productName}</strong>.
            </Text>
            {props.organizationLogo ? (
              <Section>
                <Row>
                  <Column align="center">
                    <Img
                      className="rounded-full"
                      height="64"
                      src={props.organizationLogo}
                      width="64"
                    />
                  </Column>
                </Row>
              </Section>
            ) : null}
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-[#000000] text-center text-[12px] font-semibold text-white no-underline"
                href={props.link}
                pX={20}
                pY={12}
              >
                Join {props.organizationName}
              </Button>
            </Section>
            <Text className="text-[14px] leading-[24px] text-black">
              or copy and paste this URL into your browser:{" "}
              <Link className="text-blue-600 no-underline" href={props.link}>
                {props.link}
              </Link>
            </Text>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
            <Text className="text-[12px] leading-[24px] text-[#666666]">
              This invitation was intended for{" "}
              <span className="text-black">{props.invitedUserEmail}</span>.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>,
  );
}
