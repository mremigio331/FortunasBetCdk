import { Stack, Duration } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { fortunasBet } from "../constants";

export function addCognitoMonitoring(
  scope: Stack,
  logGroup: logs.LogGroup,
  stage: string,
) {
  // CloudWatch Metric Filter for ERROR log lines
  const errorMetric = new logs.MetricFilter(
    scope,
    `${fortunasBet}-UserEventLoggerErrorMetric-${stage}`,
    {
      logGroup,
      metricNamespace: `${fortunasBet}/UserEventLogger`,
      metricName: `ErrorCount-${stage}`,
      filterPattern: logs.FilterPattern.literal('"ERROR"'),
      metricValue: "1",
    },
  );

  // CloudWatch Alarm for ERROR log lines in the last 30 minutes
  new cloudwatch.Alarm(scope, `UserEventLoggerErrorAlarm-${stage}`, {
    alarmName: `${fortunasBet}-UserEventLogger-ErrorAlarm-${stage}`,
    metric: errorMetric.metric({
      statistic: "Sum",
      period: Duration.minutes(30),
    }),
    threshold: 0,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
}
