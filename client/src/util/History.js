/**
 * Browser history singleton so that we can access history outside of React Router.
 * See: https://github.com/ReactTraining/react-router/blob/master/FAQ.md#how-do-i-access-the-history-object-outside-of-components
 */
import { createBrowserHistory } from 'history';

export default createBrowserHistory();
