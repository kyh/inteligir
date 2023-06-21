import { Column } from "@react-email/column";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import { siteConfig } from "~/config/site";

function EmailNavbar(
  props: React.PropsWithChildren<{
    productName?: string;
  }>
) {
  const productName = props.productName ?? siteConfig.site.name;

  return (
    <Section style={{ width: "100%" }}>
      <Column>
        <Text style={{ textAlign: "center" }}>
          {/* Add your logo here */}
          {productName}
        </Text>
      </Column>
    </Section>
  );
}

export default EmailNavbar;
