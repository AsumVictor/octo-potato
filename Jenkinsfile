pipeline {
  agent any

  parameters {
    string(
      name:         '/Users/vrasum/projects/Camera01/outpu',
      defaultValue: '',
      description:  'Absolute path to the project folder on this machine (e.g. /home/user/Camera01/output)'
    )
  }

  environment {
    PATH = "/opt/homebrew/bin:${env.PATH}"
  }

  stages {
    stage('Install') {
      steps {
        dir("${params.PROJECT_DIR}") {
          sh 'npm ci'
        }
      }
    }

    stage('Test') {
      steps {
        dir("${params.PROJECT_DIR}") {
          sh 'npm run test:ci'
        }
      }
    }
  }

  post {
    always {
      dir("${params.PROJECT_DIR}") {
        junit allowEmptyResults: true, testResults: 'junit.xml'
        publishHTML(target: [
          allowMissing:          true,
          alwaysLinkToLastBuild: true,
          keepAll:               true,
          reportDir:             'coverage/lcov-report',
          reportFiles:           'index.html',
          reportName:            'Coverage Report'
        ])
      }
    }
    failure {
      echo 'Tests failed — check the Test Results tab above.'
    }
  }
}
