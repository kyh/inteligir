import tw, { globalStyles } from "twin.macro";
import { global } from "styles/stitches";

const customStyles = {
  body: {
    fontFamily: "HelveticaNow, -apple-system, system-ui, sans-serif;",
    ...tw`antialiased`,
  },
};

const styles = () => {
  global(globalStyles)();
  global(customStyles)();
};

export default styles;
