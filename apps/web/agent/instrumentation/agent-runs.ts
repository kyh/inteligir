import { disableInstrumentation } from "eve/instrumentation";

// a conversation's words stay in the library's own rows: no trace of a run leaves the deployment
export default disableInstrumentation();
