import { getOctokit } from '@actions/github';

import {
  approveAndMergePullRequestMutation,
  mergePullRequestMutation,
} from '../graphql/mutations';
import { parseInputMergeMethod } from '../utilities/inputParsers';
import { logDebug, logInfo } from '../utilities/log';

export interface PullRequestDetails {
  commitHeadline: string;
  pullRequestId: string;
  reviewEdge: { node: { state: string } } | undefined;
}

const EXPONENTIAL_BACKOFF = 2;
const DEFAULT_WAIT_TIME = 1000;

const delay = async (duration: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout((): void => {
      resolve();
    }, duration);
  });
};

/**
 * Approves and merges a given Pull Request.
 */
export const merge = async (
  octokit: ReturnType<typeof getOctokit>,
  pullRequestDetails: PullRequestDetails,
): Promise<void> => {
  const mergeMethod = parseInputMergeMethod();

  const { commitHeadline, pullRequestId, reviewEdge } = pullRequestDetails;

  const mutation =
    reviewEdge === undefined
      ? approveAndMergePullRequestMutation(mergeMethod)
      : mergePullRequestMutation(mergeMethod);

  await octokit.graphql(mutation, { commitHeadline, pullRequestId });
};

export const mergeWithRetry = async (
  octokit: ReturnType<typeof getOctokit>,
  details: {
    numberOfRetries: number;
    trial: number;
  } & PullRequestDetails,
): Promise<void> => {
  const { trial, numberOfRetries } = details;

  try {
    await merge(octokit, details);
  } catch (error) {
    logInfo(
      'An error ocurred while merging the Pull Request. This is usually ' +
        'caused by the base branch being out of sync with the target ' +
        'branch. In this case, the base branch must be rebased. Some ' +
        'tools, such as Dependabot, do that automatically.',
    );
    /* eslint-disable-next-line @typescript-eslint/no-base-to-string */
    logDebug(`Original error: ${(error as Error).toString()}.`);

    if (trial <= numberOfRetries) {
      const nextRetryIn = trial ** EXPONENTIAL_BACKOFF * DEFAULT_WAIT_TIME;

      logInfo(`Retrying in ${nextRetryIn.toString()}...`);

      await delay(nextRetryIn);

      await mergeWithRetry(octokit, {
        ...details,
        numberOfRetries,
        trial: trial + 1,
      });
    } else {
      throw error;
    }
  }
};
