/**
 * Official writine serverless plugins
 * Ref: https://serverless.com/blog/writing-serverless-plugins/
 *
 * Sample list of hooks available
 * Ref: https://gist.github.com/HyperBrain/50d38027a8f57778d5b0f135d80ea406
 */

const API_KEY_HEADER = 'x-api-key';

// Capitalise first character
const ucFirst = string => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

// Construct httplistener name based on function i.e AlbpingAlbListenerRule2
const listenerName = (functionName, alb) => {
  return `${ucFirst(functionName)}AlbListenerRule${alb.priority}`;
};

const ruleName = (functionName, priority) => {
  return `${ucFirst(functionName)}InvalidApiKeyRule${priority}`;
};

/**
 * Scan through all function that has event as alb and has apiKey property
 * @param {} serverless
 */
const getAllEventWithAlb = serverless => {
  const functions = [];
  Object.keys(serverless.service.functions).forEach(key => {
    const func = serverless.service.functions[key];

    func.events.forEach(element => {
      const { alb } = element;
      if (alb && alb.apiKey) {
        functions.push({
          ...alb,
          funcName: key,
          listenerName: listenerName(key, alb),
          apiKey: alb.apiKey,
        });
      }
    });
  });
  return functions;
};

/**
 * Add Http-header condition to existing Listener
 * @param {listener, apiKey} functions Functions which requires apiKey to be added
 * @param {*} template CloudFormation Template
 */
const addNewListenerForFunctionAlb = (func, cloudFormation) => {
  const listener = cloudFormation.Resources[func.listenerName];
  listener.Properties.Conditions.push({
    Field: 'http-header',
    HttpHeaderConfig: {
      HttpHeaderName: API_KEY_HEADER,
      Values: func.apiKey,
    },
  });
};

const addInvalidApiKeyRule = (func, cloudFormation) => {
  const { funcName, priority, listenerArn, conditions, actions } = func;
  const rulePriority = 3000 + priority;
  const newRuleName = ruleName(funcName, rulePriority);

  const newRule = {
    Type: 'AWS::ElasticLoadBalancingV2::ListenerRule',
    Properties: {
      ListenerArn: listenerArn,
      Priority: 3000 + rulePriority,
    },
  };

  const newConditions = [];

  // create condition based on serverless functions
  if (conditions.path) {
    newConditions.push({
      Field: 'path-pattern',
      PathPatternConfig: {
        Values:
          conditions.path instanceof Array
            ? conditions.path
            : [conditions.path],
      },
    });
  }

  if (conditions.method) {
    newConditions.push({
      Field: 'http-request-method',
      HttpRequestMethodConfig: {
        Values:
          conditions.method instanceof Array
            ? conditions.method
            : [conditions.method],
      },
    });
  }
  newRule.Properties = { ...newRule.Properties, Conditions: newConditions };

  // if no actions is defined then we create a default action
  if (!actions) {
    const defaultAction = {
      Type: 'fixed-response',
      FixedResponseConfig: {
        StatusCode: 403,
        ContentType: 'application/json',
        MessageBody: '{ "message": "Forbidden: invalid api key" }',
      },
    };
    newRule.Properties = { ...newRule.Properties, Actions: [defaultAction] };
  } else {
    newRule.Properties = { ...newRule.Properties, Actions: actions };
  }

  // eslint-disable-next-line no-param-reassign
  cloudFormation.Resources = {
    ...cloudFormation.Resources,
    [newRuleName]: newRule,
  };
};

/**
 * Modify cloud formation to allow more listener rule that requires headers
 * with specified apiKey
 *
 * @param {*} serverless
 */
const beforeDeploy = serverless => {
  const functions = getAllEventWithAlb(serverless);
  const cloudFormation =
    serverless.service.provider.compiledCloudFormationTemplate;

  functions.forEach(func => {
    addNewListenerForFunctionAlb(func, cloudFormation);
    addInvalidApiKeyRule(func, cloudFormation);
  });

  // process.exit(1);
};

const provider = serverless => {
  return serverless ? serverless.getProvider('aws') : null;
};

/* eslint-disable class-methods-use-this */
class EventAlbApiKeyPlugin {
  constructor(serverless, options) {
    this.commands = {
      usage: 'Add listener rule to HTTP Listener for x-api-key header',
      deploy: {
        lifecycleEvents: ['resources', 'functions'],
      },
    };

    this.hooks = {
      'before:deploy:deploy': beforeDeploy.bind(null, serverless, options),
    };

    if (!provider(serverless)) {
      throw new Error('This plugin must be used with AWS');
    }
  }
}

module.exports = EventAlbApiKeyPlugin;
