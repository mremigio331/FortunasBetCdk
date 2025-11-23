import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";

export interface DashboardStackProps extends StackProps {
  stage: string;
}

export class DashboardStack extends Stack {
  constructor(scope: Construct, id: string, props: DashboardStackProps) {
    super(scope, id, props);

    const stage = props.stage;
    const namespace = "AWS/ApiGateway";
    const espnNamespace = `FortunasBet-${stage.toUpperCase()}`;
    const apiName = `FortunasBet-Api-${stage}`;
    const dashboardName = `FortunasBet-${stage}-Api-Dashboard`;

    const dashboard = new cloudwatch.Dashboard(
      this,
      `FortunasBetApiDashboard-${stage}`,
      {
        dashboardName,
      },
    );

    // Combined API Status Codes (2xx, 4xx, 5xx)
    const statusCodesWidget = new cloudwatch.GraphWidget({
      title: "API Status Codes (Count, 4xx, 5xx)",
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: "Count",
          dimensionsMap: { ApiName: apiName },
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace,
          metricName: "4XXError",
          dimensionsMap: { ApiName: apiName },
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace,
          metricName: "5XXError",
          dimensionsMap: { ApiName: apiName },
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
      ],
    });

    // Latency (Average and Maximum)
    const latencyWidget = new cloudwatch.GraphWidget({
      title: "API Latency (ms)",
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: "IntegrationLatency",
          dimensionsMap: { ApiName: apiName },
          statistic: "Average",
          period: Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace,
          metricName: "IntegrationLatency",
          dimensionsMap: { ApiName: apiName },
          statistic: "Maximum",
          period: Duration.minutes(5),
        }),
      ],
    });

    // ESPN API Calls
    const espnApiCallWidget = new cloudwatch.GraphWidget({
      title: "ESPN API Calls",
      left: [
        new cloudwatch.Metric({
          namespace: espnNamespace,
          metricName: "ESPNApiCall",
          dimensionsMap: { Service: apiName },
          statistic: "Sum",
        }),
        new cloudwatch.Metric({
          namespace: espnNamespace,
          metricName: "ESPNSuccess",
          dimensionsMap: { Service: apiName },
          statistic: "Sum",
        }),
        new cloudwatch.Metric({
          namespace: espnNamespace,
          metricName: "ESPNException",
          dimensionsMap: { Service: apiName },
          statistic: "Sum",
        }),
      ],
    });

    dashboard.addWidgets(statusCodesWidget, latencyWidget, espnApiCallWidget);
  }
}
