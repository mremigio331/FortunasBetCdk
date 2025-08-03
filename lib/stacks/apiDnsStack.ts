import {
  Stack,
  StackProps,
  aws_route53 as route53,
  aws_certificatemanager as acm,
  aws_route53_targets as targets,
  aws_apigateway as apigw,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { fortunasBet } from "../constants";

interface ApiDnsStackProps extends StackProps {
  api: apigw.RestApi;
  apiDomainName: string;
  certificateArn: string;
  hostedZoneId: string;
  rootDomainName: string;
  stage: string;
}

export class ApiDnsStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiDnsStackProps) {
    super(scope, id, props);

    const {
      api,
      apiDomainName,
      certificateArn,
      hostedZoneId,
      rootDomainName,
      stage,
    } = props;

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      `${fortunasBet}-ApiHostedZone-${stage}`,
      {
        hostedZoneId,
        zoneName: rootDomainName,
      },
    );

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      `${fortunasBet}-ImportedApiCert-${stage}`,
      certificateArn,
    );

    const customDomain = new apigw.DomainName(
      this,
      `${fortunasBet}-ApiCustomDomain-${stage}`,
      {
        domainName: apiDomainName,
        certificate: certificate!,
        endpointType: apigw.EndpointType.REGIONAL,
      },
    );

    new apigw.BasePathMapping(
      this,
      `${fortunasBet}-ApiBasePathMapping-${stage}`,
      {
        domainName: customDomain,
        restApi: api,
      },
    );

    new route53.ARecord(this, `${fortunasBet}-ApiAliasRecord-${stage}`, {
      recordName: "api",
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(customDomain),
      ),
    });
  }
}
