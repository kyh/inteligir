import { Container } from "~/components/Container";
import PricingTable from "~/components/PricingTable";
import { Text } from "~/components/Text";

export const metadata = {
  title: "Pricing",
};

function PricingPage() {
  return (
    <Container>
      <header className="px-5 pt-[70px] text-center sm:pt-[100px]">
        <Text as="h1" variant="heading1" className="mx-auto mt-3 max-w-xl">
          Pricing
        </Text>
        <p className="mx-auto mt-6 max-w-md whitespace-pre-line text-zinc-400">
          Fair pricing for your customers
        </p>
      </header>
      <PricingTable />
    </Container>
  );
}

export default PricingPage;
