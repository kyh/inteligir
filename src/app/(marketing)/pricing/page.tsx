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
          (Coming Soon)
        </Text>
      </header>
    </Container>
  );
}

export default PricingPage;
